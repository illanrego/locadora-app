//! App-owned, embedded engine. Never searches PATH for Stremio or adopts a listener.
use crate::tape_diagnostics::{
    EngineLogThreads, TapeDiagnosticsState, TapeEvent, engine_log_path, start_engine_log,
};
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
pub const TAPE_PORT: u16 = 11472;
pub const TAPE_URL: &str = "http://127.0.0.1:11472/";
const DEFAULT_TAPE_PEER_PORT: u16 = 6881;
const DEFAULT_TAPE_MAX_SEED_RATIO: f64 = 0.0;
const BINARY: &[u8] = include_bytes!("../resources/streaming-engine/stremio-server");
const LICENSE: &[u8] = include_bytes!("../resources/streaming-engine/LICENSE");
const PROVENANCE: &[u8] = include_bytes!("../resources/streaming-engine/provenance.json");
const SBOM: &[u8] = include_bytes!("../resources/streaming-engine/sbom.json");

#[derive(Default)]
pub struct EngineState {
    inner: Mutex<Engine>,
    tape: Mutex<TapeEngine>,
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

#[derive(Default)]
struct TapeEngine {
    child: Option<Child>,
    store: Option<PathBuf>,
    diagnostic_threads: Option<EngineLogThreads>,
    // See Engine::spawn_thread. The tape process needs the same parent-death guarantee.
    spawn_thread: Option<(std::sync::mpsc::Sender<()>, thread::JoinHandle<()>)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineReady {
    url: &'static str,
    version: &'static str,
}

#[derive(Serialize)]
pub struct TapeEngineReady {
    url: &'static str,
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

#[derive(Debug, PartialEq)]
enum TapeCommandOutput {
    Null,
    Diagnostics(PathBuf),
}

struct TapeCommand {
    command: Command,
    output: TapeCommandOutput,
}

struct TapeSpawnOptions<'a> {
    peer_port: u16,
    max_seed_ratio: f64,
    diagnostics_cache_root: Option<&'a Path>,
}

fn tape_command(
    binary: &Path,
    store: &Path,
    port: u16,
    peer_port: u16,
    max_seed_ratio: f64,
    diagnostics_cache_root: Option<&Path>,
) -> TapeCommand {
    let mut command = Command::new(binary);
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("APP_PATH", store)
        .env("BIND_ADDRESS", "127.0.0.1")
        .env("HTTP_PORT", port.to_string())
        .env("HTTPS_PORT", "0")
        .env(
            "STREMIO_ALLOWED_ORIGINS",
            "tauri://localhost,http://tauri.localhost",
        )
        .env("STREMIO_MEM_LIMIT", "268435456")
        .env("STREMIO_TORRENT_IDLE_TIMEOUT", "0")
        .env("STREMIO_MAX_SEED_RATIO", max_seed_ratio.to_string())
        .env("BT_LISTEN_PORT", peer_port.to_string())
        .env("STREMIO_TRACKERS_URL", "off")
        .env("STREMIO_LOCAL_IMDB", "off")
        .env("STREMIO_METADATA_URL", "off")
        .env("STREMIO_ENABLE_DLNA", "0")
        .env("STREMIO_DISABLE_WEBTORRENT", "1")
        .current_dir(store)
        .stdin(Stdio::null())
        .process_group(0);
    let output = if let Some(root) = diagnostics_cache_root {
        command
            .env("STREMIO_LOG_LEVEL", "info")
            .env("STREMIO_HTTP_LOG", "1")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        TapeCommandOutput::Diagnostics(root.to_path_buf())
    } else {
        command
            .env("STREMIO_LOG_LEVEL", "error")
            .env("STREMIO_HTTP_LOG", "0")
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        TapeCommandOutput::Null
    };
    TapeCommand { command, output }
}

impl TapeEngine {
    fn alive(&mut self) -> bool {
        self.child
            .as_mut()
            .is_some_and(|child| matches!(child.try_wait(), Ok(None)))
    }

    fn ensure(
        &mut self,
        binary_root: &Path,
        store: &Path,
        port: u16,
        options: TapeSpawnOptions<'_>,
        closing: &AtomicBool,
    ) -> Result<(), String> {
        if closing.load(Ordering::SeqCst) {
            return Err("Application is closing".into());
        }
        if self.alive() {
            return Ok(());
        }
        self.stop();
        let reservation = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).map_err(
            |_| "Locadora's tape engine port is busy. Close the conflicting application and retry.",
        )?;
        let binary = materialize(binary_root)?;
        private_dir(store)?;
        self.store = Some(store.to_path_buf());
        let TapeCommand {
            mut command,
            output,
        } = tape_command(
            &binary,
            store,
            port,
            options.peer_port,
            options.max_seed_ratio,
            options.diagnostics_cache_root,
        );
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
            Ok(Ok(mut child)) => {
                if let TapeCommandOutput::Diagnostics(cache_root) = output {
                    let path = engine_log_path(&cache_root, child.id());
                    self.diagnostic_threads = Some(start_engine_log(
                        &path,
                        child.stdout.take(),
                        child.stderr.take(),
                    ));
                }
                self.child = Some(child);
            }
            _ => {
                self.stop();
                return Err("Could not start the bundled tape engine".into());
            }
        }
        let result = self.wait_ready(port, store, closing);
        if result.is_err() {
            self.stop();
        }
        result
    }

    fn wait_ready(&mut self, port: u16, store: &Path, closing: &AtomicBool) -> Result<(), String> {
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(600))
            .build()
            .map_err(|_| "Could not initialize tape engine readiness check")?;
        let settings_url = format!("http://127.0.0.1:{port}/settings");
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if closing.load(Ordering::SeqCst) {
                return Err("Application is closing".into());
            }
            if !self.alive() {
                return Err("The bundled tape engine stopped during startup. Retry.".into());
            }
            if let Ok(response) = client.get(&settings_url).send()
                && response.status().is_success()
            {
                let mut bytes = Vec::new();
                if response.take(65_537).read_to_end(&mut bytes).is_ok()
                    && bytes.len() <= 65_536
                    && let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes)
                    && json["values"]["appPath"].as_str() == store.to_str()
                    && json["values"]["serverVersion"].as_str() == Some("4.21.0")
                    && self.alive()
                {
                    let configured = client
                        .post(&settings_url)
                        .json(&serde_json::json!({
                            "cacheSize": null,
                            "seedingEnabled": true
                        }))
                        .send()
                        .and_then(reqwest::blocking::Response::error_for_status)
                        .and_then(reqwest::blocking::Response::json::<serde_json::Value>)
                        .ok()
                        .is_some_and(|value| value["success"].as_bool() == Some(true));
                    if configured {
                        return Ok(());
                    }
                    return Err("Could not configure the tape engine storage policy".into());
                }
            }
            thread::sleep(Duration::from_millis(100));
        }
        Err("The bundled tape engine did not become ready. Retry.".into())
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
        if let Some(threads) = self.diagnostic_threads.take() {
            threads.join();
        }
        // The durable tape store is rental-owned and is never removed at shutdown.
        self.store = None;
    }
}

impl Drop for TapeEngine {
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
        if let Ok(mut engine) = self.tape.lock() {
            engine.stop();
        }
    }
    pub fn is_ready(&self) -> bool {
        self.inner.lock().is_ok_and(|mut engine| engine.alive())
    }

    fn tape_is_ready(&self) -> bool {
        self.tape.lock().is_ok_and(|mut engine| engine.alive())
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

#[tauri::command]
pub async fn tape_engine_ensure(
    app: AppHandle,
    peer_port: Option<u16>,
    max_seed_ratio: Option<f64>,
) -> Result<TapeEngineReady, String> {
    let cache_root = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Could not locate engine storage")?;
    let binary_root = cache_root.join("streaming-engine");
    let store = app
        .path()
        .app_data_dir()
        .map_err(|_| "Could not locate tape storage")?
        .join("tape-store");
    let peer_port = peer_port.unwrap_or(DEFAULT_TAPE_PEER_PORT);
    // Local tape settings are sampled at process spawn. Changing either value
    // deliberately takes effect on the next lazy start; P4 adds no restart path.
    let max_seed_ratio = max_seed_ratio
        .filter(|ratio| ratio.is_finite() && *ratio >= 0.0)
        .unwrap_or(DEFAULT_TAPE_MAX_SEED_RATIO);
    let diagnostics_cache_root = app
        .state::<TapeDiagnosticsState>()
        .is_enabled()
        .then_some(cache_root);
    let diagnostics_app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<EngineState>();
        let mut engine = state
            .tape
            .lock()
            .map_err(|_| "Tape engine state is unavailable")?;
        engine.ensure(
            &binary_root,
            &store,
            TAPE_PORT,
            TapeSpawnOptions {
                peer_port,
                max_seed_ratio,
                diagnostics_cache_root: diagnostics_cache_root.as_deref(),
            },
            &state.closing,
        )?;
        Ok(TapeEngineReady { url: TAPE_URL })
    })
    .await
    .map_err(|_| "Tape startup task failed")?
    .inspect(|_| {
        crate::tape_diagnostics::record(&diagnostics_app, TapeEvent::Ensure { info_hash: None });
    })
}

#[tauri::command]
pub fn tape_engine_status(state: State<'_, EngineState>) -> bool {
    state.tape_is_ready()
}

fn tape_path_allowed(path: &str) -> bool {
    if path == "/settings" {
        return true;
    }
    let Some(relative) = path.strip_prefix('/') else {
        return false;
    };
    if relative.starts_with('/') {
        return false;
    }
    let parts: Vec<_> = relative.split('/').collect();
    let hash_valid = parts.first().is_some_and(|hash| {
        hash.len() == 40
            && hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    });
    if !hash_valid || parts.len() > 3 {
        return false;
    }
    let index_valid = |part: &str| {
        (1..=4).contains(&part.len()) && part.bytes().all(|byte| byte.is_ascii_digit())
    };
    let action_valid = |part: &str| matches!(part, "stats.json" | "create" | "remove");
    match parts.as_slice() {
        [_] => true,
        [_, second] => index_valid(second) || action_valid(second),
        [_, second, third] => index_valid(second) && action_valid(third),
        _ => false,
    }
}

fn tape_request_allowed(url: &url::Url, method: &str, body: Option<&str>) -> bool {
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(TAPE_PORT)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.as_str().len() > 32_768
        || body.is_some_and(|body| body.len() > 3 * 1024 * 1024)
        || !tape_path_allowed(url.path())
    {
        return false;
    }
    let is_create = url.path().split('/').next_back() == Some("create");
    let is_settings = url.path() == "/settings";
    match method {
        "POST" if is_settings => body.is_some_and(tape_settings_body_allowed),
        "POST" => is_create,
        "GET" => !is_create && !is_settings && body.is_none(),
        _ => false,
    }
}

fn tape_settings_body_allowed(body: &str) -> bool {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(body) else {
        return false;
    };
    let Some(object) = value.as_object() else {
        return false;
    };
    object.len() == 1
        && object
            .get("seedingEnabled")
            .is_some_and(|value| value.is_boolean())
}

fn tape_request_spelling_allowed(raw: &str, parsed: &url::Url) -> bool {
    parsed.path() != "/settings" || raw == format!("{TAPE_URL}settings")
}

#[tauri::command]
pub async fn tape_engine_request(
    app: AppHandle,
    state: State<'_, EngineState>,
    url: String,
    method: String,
    body: Option<String>,
) -> Result<EngineResponse, String> {
    let parsed = url::Url::parse(&url).map_err(|_| "Invalid tape engine request")?;
    if !tape_request_spelling_allowed(&url, &parsed)
        || !tape_request_allowed(&parsed, &method, body.as_deref())
        || !state.tape_is_ready()
    {
        return Err("Tape engine request is unavailable or not permitted".into());
    }
    let client = reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|_| "Could not initialize tape engine request")?;
    let mut request = client.request(
        if method == "POST" {
            reqwest::Method::POST
        } else {
            reqwest::Method::GET
        },
        parsed.clone(),
    );
    if let Some(body) = body {
        request = request
            .header("content-type", "application/json")
            .body(body);
    }
    let mut response = request
        .send()
        .await
        .map_err(|_| "Tape engine request failed. Retry.")?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json")
        .to_string();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Could not read tape engine response")?
    {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err("Tape engine response exceeded limit".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let response = EngineResponse {
        status,
        body: String::from_utf8(bytes).map_err(|_| "Invalid tape engine response")?,
        content_type,
    };
    let parts = parsed
        .path()
        .trim_start_matches('/')
        .split('/')
        .collect::<Vec<_>>();
    if let Some(info_hash) = parts.first().filter(|hash| hash.len() == 40)
        && parts.last().copied() == Some("create")
    {
        crate::tape_diagnostics::record(
            &app,
            TapeEvent::Create {
                info_hash: (*info_hash).into(),
                http_status: status,
            },
        );
    }
    Ok(response)
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

    fn command_env(command: &Command, key: &str) -> Option<String> {
        command
            .get_envs()
            .find(|(name, _)| *name == key)
            .and_then(|(_, value)| value)
            .map(|value| value.to_string_lossy().into_owned())
    }

    #[test]
    fn tape_role_has_distinct_fixed_port_and_disk_environment() {
        let store = Path::new("/private/tape-store");
        let plan = tape_command(
            Path::new("/private/engine"),
            store,
            TAPE_PORT,
            DEFAULT_TAPE_PEER_PORT,
            DEFAULT_TAPE_MAX_SEED_RATIO,
            None,
        );
        assert_eq!(plan.output, TapeCommandOutput::Null);
        let command = plan.command;
        assert_eq!(PORT, 11471);
        assert_eq!(TAPE_PORT, 11472);
        assert_ne!(PORT, TAPE_PORT);
        assert_eq!(URL, "http://127.0.0.1:11471/");
        assert_eq!(TAPE_URL, "http://127.0.0.1:11472/");
        assert_eq!(command_env(&command, "APP_PATH").as_deref(), store.to_str());
        assert_eq!(command_env(&command, "HTTP_PORT").as_deref(), Some("11472"));
        assert_eq!(command_env(&command, "STREMIO_MEMORY_CACHE_SIZE"), None);
        assert_eq!(
            command_env(&command, "STREMIO_TORRENT_IDLE_TIMEOUT").as_deref(),
            Some("0")
        );
        assert_eq!(
            command_env(&command, "STREMIO_MAX_SEED_RATIO").as_deref(),
            Some("0")
        );
        assert_eq!(
            command_env(&command, "BT_LISTEN_PORT").as_deref(),
            Some("6881")
        );
        assert_eq!(
            command_env(&command, "STREMIO_MEM_LIMIT").as_deref(),
            Some("268435456")
        );
        assert_eq!(
            command_env(&command, "STREMIO_DISABLE_WEBTORRENT").as_deref(),
            Some("1")
        );
        assert_eq!(
            command_env(&command, "STREMIO_TRACKERS_URL").as_deref(),
            Some("off")
        );
        assert_eq!(
            command_env(&command, "STREMIO_LOG_LEVEL").as_deref(),
            Some("error")
        );
        assert_eq!(
            command_env(&command, "STREMIO_HTTP_LOG").as_deref(),
            Some("0")
        );
    }

    #[test]
    fn tape_diagnostics_change_only_engine_b_logging() {
        let cache = Path::new("/private/cache");
        let plan = tape_command(
            Path::new("/private/engine"),
            Path::new("/private/tape-store"),
            TAPE_PORT,
            DEFAULT_TAPE_PEER_PORT,
            DEFAULT_TAPE_MAX_SEED_RATIO,
            Some(cache),
        );
        assert_eq!(
            plan.output,
            TapeCommandOutput::Diagnostics(cache.to_path_buf())
        );
        assert_eq!(
            command_env(&plan.command, "STREMIO_LOG_LEVEL").as_deref(),
            Some("info")
        );
        assert_eq!(
            command_env(&plan.command, "STREMIO_HTTP_LOG").as_deref(),
            Some("1")
        );
        assert_eq!(
            engine_log_path(cache, 4321),
            Path::new("/private/cache/diagnostics/tape-engine-4321.log")
        );
    }

    #[test]
    fn tape_role_reads_ratio_and_peer_port_at_spawn() {
        let command = tape_command(
            Path::new("/private/engine"),
            Path::new("/private/tape-store"),
            TAPE_PORT,
            0,
            1.5,
            None,
        );
        let command = command.command;
        assert_eq!(
            command_env(&command, "STREMIO_MAX_SEED_RATIO").as_deref(),
            Some("1.5")
        );
        assert_eq!(
            command_env(&command, "BT_LISTEN_PORT").as_deref(),
            Some("0")
        );
    }

    #[test]
    fn tape_engine_is_lazy_until_explicit_ensure() {
        let state = EngineState::default();
        assert!(state.tape.lock().unwrap().child.is_none());
        assert!(!state.tape_is_ready());
        assert!(state.tape.lock().unwrap().child.is_none());
        assert!(!state.is_ready());
        assert!(state.tape.lock().unwrap().child.is_none());
    }

    #[test]
    fn tape_engine_conflict_is_fail_closed_and_drop_preserves_store() {
        let root = std::env::temp_dir().join(format!(
            "locadora-tape-engine-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let binary_root = root.join("engine");
        let store = root.join("tape-store");
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let closing = AtomicBool::new(false);
        let mut engine = TapeEngine::default();
        assert!(
            engine
                .ensure(
                    &binary_root,
                    &store,
                    port,
                    TapeSpawnOptions {
                        peer_port: 0,
                        max_seed_ratio: 0.0,
                        diagnostics_cache_root: None,
                    },
                    &closing,
                )
                .unwrap_err()
                .contains("busy")
        );
        assert!(engine.child.is_none());
        drop(listener);

        engine
            .ensure(
                &binary_root,
                &store,
                port,
                TapeSpawnOptions {
                    peer_port: 0,
                    max_seed_ratio: 0.0,
                    diagnostics_cache_root: None,
                },
                &closing,
            )
            .unwrap();
        assert!(engine.alive());
        assert_eq!(
            fs::metadata(&store).unwrap().permissions().mode() & 0o777,
            0o700
        );
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let settings: serde_json::Value = client
            .get(format!("http://127.0.0.1:{port}/settings"))
            .send()
            .unwrap()
            .error_for_status()
            .unwrap()
            .json()
            .unwrap();
        assert!(settings["values"]["cacheSize"].is_null());
        assert_eq!(settings["values"]["seedingEnabled"].as_bool(), Some(true));

        let retained = store.join("retained-after-drop");
        fs::write(&retained, b"fixture").unwrap();
        engine.stop();
        assert!(!engine.alive());
        assert!(
            retained.exists(),
            "tape engine teardown removed its durable store"
        );
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok());
        fs::remove_dir_all(root).unwrap();
    }

    fn parsed_tape_url(path: &str) -> url::Url {
        url::Url::parse(&format!(
            "{TAPE_URL}{}",
            path.strip_prefix('/').unwrap_or(path)
        ))
        .unwrap()
    }

    #[test]
    fn tape_bridge_accepts_only_the_frozen_path_shapes() {
        let hash = "a".repeat(40);
        for (path, method, body) in [
            (format!("/{hash}"), "GET", None),
            (format!("/{hash}/3"), "GET", None),
            (format!("/{hash}/stats.json"), "GET", None),
            (format!("/{hash}/3/stats.json"), "GET", None),
            (format!("/{hash}/remove"), "GET", None),
            (format!("/{hash}/create"), "POST", Some("{}")),
        ] {
            assert!(tape_request_allowed(&parsed_tape_url(&path), method, body));
        }
    }

    #[test]
    fn tape_bridge_accepts_only_the_runtime_seeding_setting() {
        let settings = url::Url::parse(&format!("{TAPE_URL}settings")).unwrap();
        for body in [r#"{"seedingEnabled":true}"#, r#"{"seedingEnabled":false}"#] {
            assert!(tape_request_allowed(&settings, "POST", Some(body)));
        }
        for (method, body) in [
            ("GET", None),
            ("POST", None),
            ("POST", Some("{}")),
            ("POST", Some(r#"{"seedingEnabled":true,"cacheSize":null}"#)),
            ("POST", Some(r#"{"seedingEnabled":1}"#)),
        ] {
            assert!(!tape_request_allowed(&settings, method, body));
        }
        let normalized = format!("{TAPE_URL}{}/../settings", "a".repeat(40));
        let parsed = url::Url::parse(&normalized).unwrap();
        assert_eq!(parsed.path(), "/settings");
        assert!(!tape_request_spelling_allowed(&normalized, &parsed));
    }

    #[test]
    fn tape_bridge_rejects_wrong_origin() {
        let hash = "a".repeat(40);
        for address in [
            format!("http://127.0.0.1:11471/{hash}/remove"),
            format!("https://127.0.0.1:11472/{hash}/remove"),
            format!("http://localhost:11472/{hash}/remove"),
        ] {
            assert!(!tape_request_allowed(
                &url::Url::parse(&address).unwrap(),
                "GET",
                None
            ));
        }
    }

    #[test]
    fn tape_bridge_rejects_wrong_method() {
        let hash = "a".repeat(40);
        assert!(!tape_request_allowed(
            &parsed_tape_url(&format!("/{hash}/create")),
            "PUT",
            Some("{}")
        ));
        assert!(!tape_request_allowed(
            &parsed_tape_url(&format!("/{hash}/remove")),
            "POST",
            None
        ));
    }

    #[test]
    fn tape_bridge_rejects_bad_path() {
        let hash = "a".repeat(40);
        for path in [
            format!("/{}", "A".repeat(40)),
            format!("//{hash}/remove"),
            format!("/{hash}/10000/stats.json"),
            format!("/{hash}/proxy"),
            format!("/{hash}/1/stats.json/extra"),
        ] {
            assert!(!tape_request_allowed(&parsed_tape_url(&path), "GET", None));
        }
    }

    #[test]
    fn tape_bridge_rejects_oversized_body() {
        let hash = "a".repeat(40);
        let oversized = "x".repeat(3 * 1024 * 1024 + 1);
        assert!(!tape_request_allowed(
            &parsed_tape_url(&format!("/{hash}/create")),
            "POST",
            Some(&oversized)
        ));
    }

    #[test]
    fn tape_bridge_rejects_body_for_non_create_path() {
        let hash = "a".repeat(40);
        assert!(!tape_request_allowed(
            &parsed_tape_url(&format!("/{hash}/remove")),
            "GET",
            Some("{}")
        ));
    }
}
