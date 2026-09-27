//! App-owned, embedded engine. Never searches PATH for Stremio or adopts a listener.
use serde::Serialize;
use std::{
    fs,
    io::{Read, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpListener},
    os::unix::{fs::PermissionsExt, process::CommandExt},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

pub const PORT: u16 = 11471;
pub const URL: &str = "http://127.0.0.1:11471/";
const BINARY: &[u8] = include_bytes!("../resources/streaming-engine/stremio-server");
const LICENSE: &[u8] = include_bytes!("../resources/streaming-engine/LICENSE");
const PROVENANCE: &[u8] = include_bytes!("../resources/streaming-engine/provenance.json");
const SBOM: &[u8] = include_bytes!("../resources/streaming-engine/sbom.json");

#[derive(Default)]
pub struct EngineState {
    inner: Mutex<Engine>,
    closing: AtomicBool,
}

#[derive(Default)]
struct Engine {
    child: Option<Child>,
    session: Option<PathBuf>,
    // PR_SET_PDEATHSIG follows the spawning Linux thread, not just the process.
    // Keep that thread alive; an idle async-runtime worker can otherwise retire.
    spawn_thread: Option<(std::sync::mpsc::Sender<()>, thread::JoinHandle<()>)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineReady {
    url: &'static str,
    version: &'static str,
}

fn private_dir(path: &Path) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|_| "Could not create streaming engine storage")?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Could not protect streaming engine storage".into())
}

fn materialize(root: &Path) -> Result<PathBuf, String> {
    private_dir(root)?;
    let binary = root.join("locadora-streaming-engine-v0.16.1");
    if fs::read(&binary).ok().as_deref() != Some(BINARY) {
        // Write a new inode before replacement, so a running engine is never truncated.
        let temp = root.join(format!("engine-{}.tmp", std::process::id()));
        let mut file = fs::File::create(&temp).map_err(|_| "Could not unpack streaming engine")?;
        file.write_all(BINARY)
            .map_err(|_| "Could not unpack streaming engine")?;
        file.sync_all()
            .map_err(|_| "Could not save streaming engine")?;
        fs::set_permissions(&temp, fs::Permissions::from_mode(0o700))
            .map_err(|_| "Could not set streaming engine permissions")?;
        fs::rename(temp, &binary).map_err(|_| "Could not install streaming engine")?;
    }
    fs::set_permissions(&binary, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Could not set streaming engine permissions")?;
    for (name, bytes) in [
        ("LICENSE", LICENSE),
        ("provenance.json", PROVENANCE),
        ("sbom.json", SBOM),
    ] {
        fs::write(root.join(name), bytes).map_err(|_| "Could not save engine notices")?;
    }
    Ok(binary)
}

impl Engine {
    fn alive(&mut self) -> bool {
        self.child
            .as_mut()
            .is_some_and(|child| matches!(child.try_wait(), Ok(None)))
    }

    fn ensure(&mut self, root: &Path, port: u16, closing: &AtomicBool) -> Result<(), String> {
        if closing.load(Ordering::SeqCst) {
            return Err("Application is closing".into());
        }
        if self.alive() {
            return Ok(());
        }
        self.stop();
        // Fail closed on conflicts, including another Locadora instance. Never adopt it.
        let reservation = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).map_err(
            |_| "Locadora's streaming port is busy. Close the other Locadora instance and retry.",
        )?;
        let binary = materialize(root)?;
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let session = root.join(format!("session-{}-{nonce}", std::process::id()));
        private_dir(&session)?;
        self.session = Some(session.clone());
        // RAM-only torrent pieces; disk contains only private runtime configuration.
        let mut command = Command::new(binary);
        command
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("APP_PATH", &session)
            .env("BIND_ADDRESS", "127.0.0.1")
            .env("HTTP_PORT", port.to_string())
            .env("HTTPS_PORT", "0")
            .env(
                "STREMIO_ALLOWED_ORIGINS",
                "tauri://localhost,http://tauri.localhost",
            )
            .env("STREMIO_MEMORY_CACHE_SIZE", "268435456")
            .env("STREMIO_MEM_LIMIT", "536870912")
            .env("STREMIO_TORRENT_IDLE_TIMEOUT", "30")
            .env("STREMIO_TRACKERS_URL", "off")
            .env("STREMIO_LOCAL_IMDB", "off")
            .env("STREMIO_METADATA_URL", "off")
            .env("STREMIO_ENABLE_DLNA", "0")
            .env("STREMIO_DISABLE_WEBTORRENT", "1")
            .env("STREMIO_LOG_LEVEL", "error")
            .env("STREMIO_HTTP_LOG", "0")
            .current_dir(&session)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .process_group(0);
        let parent = std::process::id();
        // SAFETY: only async-signal-safe libc operations between fork and exec.
        unsafe {
            command.pre_exec(move || {
                if libc::prctl(libc::PR_SET_PDEATHSIG, libc::SIGTERM) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                if libc::getppid() as u32 != parent {
                    libc::_exit(1);
                }
                Ok(())
            });
        }
        drop(reservation);
        let (child_tx, child_rx) = std::sync::mpsc::sync_channel(1);
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let thread = thread::spawn(move || {
            let _ = child_tx.send(command.spawn());
            let _ = release_rx.recv();
        });
        self.spawn_thread = Some((release_tx, thread));
        match child_rx.recv() {
            Ok(Ok(child)) => self.child = Some(child),
            _ => {
                self.stop();
                return Err("Could not start the bundled streaming engine".into());
            }
        }
        let result = self.wait_ready(port, &session, closing);
        if result.is_err() {
            self.stop();
        }
        result
    }

    fn wait_ready(
        &mut self,
        port: u16,
        session: &Path,
        closing: &AtomicBool,
    ) -> Result<(), String> {
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(600))
            .build()
            .map_err(|_| "Could not initialize streaming readiness check")?;
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if closing.load(Ordering::SeqCst) {
                return Err("Application is closing".into());
            }
            if !self.alive() {
                return Err(
                    "The bundled streaming engine stopped during startup. Retry playback.".into(),
                );
            }
            if let Ok(response) = client
                .get(format!("http://127.0.0.1:{port}/settings"))
                .send()
                && response.status().is_success()
            {
                let mut bytes = Vec::new();
                if response.take(65_537).read_to_end(&mut bytes).is_ok()
                    && bytes.len() <= 65_536
                    && let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes)
                    && json["values"]["appPath"].as_str() == session.to_str()
                    && json["values"]["serverVersion"].as_str() == Some("4.21.0")
                    && self.alive()
                {
                    return Ok(());
                }
            }
            thread::sleep(Duration::from_millis(100));
        }
        Err("The bundled streaming engine did not become ready. Retry playback.".into())
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            if matches!(child.try_wait(), Ok(None)) {
                let group = -(child.id() as i32);
                // SAFETY: child is unreaped and this process created its process group.
                unsafe {
                    libc::kill(group, libc::SIGTERM);
                }
                let deadline = Instant::now() + Duration::from_secs(2);
                while matches!(child.try_wait(), Ok(None)) && Instant::now() < deadline {
                    thread::sleep(Duration::from_millis(25));
                }
                if matches!(child.try_wait(), Ok(None)) {
                    unsafe {
                        libc::kill(group, libc::SIGKILL);
                    }
                }
            }
            let _ = child.wait();
        }
        if let Some((release, thread)) = self.spawn_thread.take() {
            let _ = release.send(());
            let _ = thread.join();
        }
        // Only the unique directory created by this Engine instance is removed.
        if let Some(session) = self.session.take() {
            let _ = fs::remove_dir_all(session);
        }
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        self.stop();
    }
}

impl EngineState {
    pub fn shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);
        if let Ok(mut engine) = self.inner.lock() {
            engine.stop();
        }
    }
    pub fn is_ready(&self) -> bool {
        self.inner.lock().is_ok_and(|mut engine| engine.alive())
    }
}

#[tauri::command]
pub async fn streaming_engine_ensure(app: AppHandle) -> Result<EngineReady, String> {
    let root = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Could not locate engine storage")?
        .join("streaming-engine");
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let mut engine = state
            .inner
            .lock()
            .map_err(|_| "Streaming engine state is unavailable")?;
        engine.ensure(&root, PORT, &state.closing)?;
        Ok(EngineReady {
            url: URL,
            version: "0.16.1",
        })
    })
    .await
    .map_err(|_| "Streaming startup task failed")?
}

#[tauri::command]
pub fn streaming_engine_status(state: State<'_, EngineState>) -> bool {
    state.is_ready()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineResponse {
    status: u16,
    body: String,
    content_type: String,
}

fn control_request_allowed(url: &url::Url, method: &str, body: Option<&str>) -> bool {
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(PORT)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || body.is_some_and(|body| body.len() > 3 * 1024 * 1024)
    {
        return false;
    }
    if url.as_str().len() > 32_768 {
        return false;
    }
    for (key, value) in url.query_pairs() {
        if key == "mediaURL" || key == "videoUrl" {
            let Ok(media) = url::Url::parse(&value) else {
                return false;
            };
            let parts: Vec<_> = media.path().trim_start_matches('/').split('/').collect();
            if media.scheme() != "http"
                || media.host_str() != Some("127.0.0.1")
                || media.port() != Some(PORT)
                || !media.username().is_empty()
                || media.password().is_some()
                || parts.len() != 2
                || parts[0].len() != 40
                || !parts[0].bytes().all(|c| c.is_ascii_hexdigit())
                || parts[1].parse::<i32>().is_err()
            {
                return false;
            }
        } else if key != "container" {
            return false;
        }
    }
    let parts: Vec<_> = url.path().trim_start_matches('/').split('/').collect();
    let torrent_path = parts
        .first()
        .is_some_and(|hash| hash.len() == 40 && hash.bytes().all(|c| c.is_ascii_hexdigit()));
    match method {
        "POST" => torrent_path && parts.len() == 2 && parts[1] == "create",
        "GET" => {
            matches!(
                url.path(),
                "/settings"
                    | "/embedded-ass"
                    | "/hlsv2/probe"
                    | "/opensubHash"
                    | "/subtitleSignature"
            ) || (torrent_path
                && (parts.len() == 2 || parts.len() == 3)
                && parts.last() == Some(&"stats.json"))
        }
        _ => false,
    }
}

#[tauri::command]
pub async fn streaming_engine_request(
    state: State<'_, EngineState>,
    url: String,
    method: String,
    body: Option<String>,
) -> Result<EngineResponse, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid engine request")?;
    if !control_request_allowed(&parsed, &method, body.as_deref()) || !state.is_ready() {
        return Err("Bundled engine request is unavailable or not permitted".into());
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "Could not initialize engine request")?;
    let mut request = client.request(
        if method == "POST" {
            reqwest::Method::POST
        } else {
            reqwest::Method::GET
        },
        parsed,
    );
    if let Some(body) = body {
        request = request
            .header("content-type", "application/json")
            .body(body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "Bundled engine request failed. Retry playback.")?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read engine response")?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("Engine response exceeded limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(EngineResponse {
        status,
        body: String::from_utf8(bytes).map_err(|_| "Invalid engine response")?,
        content_type,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn control_bridge_is_bounded_to_owned_metadata_endpoints() {
        let base = format!("{URL}{}", "a".repeat(40));
        assert!(control_request_allowed(
            &url::Url::parse(&format!("{base}/create")).unwrap(),
            "POST",
            Some("{}")
        ));
        assert!(control_request_allowed(
            &url::Url::parse(&format!("{base}/0/stats.json")).unwrap(),
            "GET",
            None
        ));
        for address in [
            "http://127.0.0.1:11470/settings",
            "http://127.0.0.1:11471/proxy/foo",
            "https://host.example.invalid/settings",
            "http://127.0.0.1:11471/hlsv2/probe?mediaURL=file:///etc/passwd",
        ] {
            assert!(!control_request_allowed(
                &url::Url::parse(address).unwrap(),
                "GET",
                None
            ));
        }
        assert!(!control_request_allowed(
            &url::Url::parse(&format!("{URL}settings")).unwrap(),
            "POST",
            Some("{}")
        ));
    }

    #[test]
    fn bundled_engine_lifecycle_and_conflict() {
        let root =
            std::env::temp_dir().join(format!("locadora-engine-test-{}", std::process::id()));
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let closing = AtomicBool::new(false);
        let mut engine = Engine::default();
        assert!(
            engine
                .ensure(&root, port, &closing)
                .unwrap_err()
                .contains("busy")
        );
        assert!(listener.local_addr().is_ok());
        drop(listener);
        engine.ensure(&root, port, &closing).unwrap();
        let first_pid = engine.child.as_ref().unwrap().id();
        // Metadata-only, empty synthetic torrent: no copyrighted media or peer fetch.
        let fixture = b"d4:infod6:lengthi0e4:name11:fixture.mp412:piece lengthi16384e6:pieces0:ee";
        let blob: String = fixture.iter().map(|byte| format!("{byte:02x}")).collect();
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let base = format!("http://127.0.0.1:{port}");
        let created: serde_json::Value = client
            .post(format!("{base}/create"))
            .json(&serde_json::json!({"blob": blob}))
            .send()
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .unwrap();
        let hash = created["infoHash"].as_str().unwrap();
        // Same create shape used by official Stremio Video for automatic file selection.
        let response = client
            .post(format!("{base}/{hash}/create"))
            .json(&serde_json::json!({"torrent": {"infoHash": hash}, "guessFileIdx": {}}))
            .send()
            .unwrap()
            .error_for_status()
            .unwrap();
        let stats: serde_json::Value = response.json().unwrap();
        assert_eq!(stats["guessedFileIdx"], 0);
        assert!(
            client
                .get(format!("{base}/{hash}/0/stats.json"))
                .send()
                .unwrap()
                .status()
                .is_success()
        );
        assert_eq!(
            client
                .get(format!("{base}/settings"))
                .header("Origin", "https://hostile.example.invalid")
                .send()
                .unwrap()
                .status()
                .as_u16(),
            403
        );
        engine.ensure(&root, port, &closing).unwrap();
        assert_eq!(engine.child.as_ref().unwrap().id(), first_pid);
        engine.child.as_mut().unwrap().kill().unwrap();
        engine.child.as_mut().unwrap().wait().unwrap();
        engine.ensure(&root, port, &closing).unwrap();
        assert_ne!(engine.child.as_ref().unwrap().id(), first_pid);
        let session = engine.session.clone().unwrap();
        engine.stop();
        assert!(!engine.alive());
        assert!(!session.exists());
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok());
        closing.store(true, Ordering::SeqCst);
        assert!(engine.ensure(&root, port, &closing).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
