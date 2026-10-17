use crate::EmbeddedMpv;
use crate::playback_diagnostics::{PROPERTIES as DIAGNOSTIC_PROPERTIES, PlaybackDiagnostics};
use serde::Serialize;
use serde_json::{Value, json};
use std::sync::Arc;
use std::{
    fs,
    io::{BufRead, BufReader, BufWriter, Write},
    os::unix::{fs::PermissionsExt, net::UnixStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender},
    },
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use url::{Host, Url};

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
/// `sockaddr_un::sun_path` holds 108 bytes on Linux, and mpv fails to bind a
/// longer path without any diagnostic. Keep a clear margin below that edge.
const MAX_SOCKET_PATH_BYTES: usize = 100;

#[derive(Debug, Error)]
pub enum PlayerError {
    #[error("mpv is unavailable")]
    Unavailable,
    #[error("mpv did not open its private control channel")]
    ControlUnavailable,
    #[error("The playback descriptor is not allowed")]
    InvalidDescriptor,
    #[error("The playback descriptor is not allowed ({0})")]
    DescriptorRejected(String),
    #[error("The player command failed")]
    CommandFailed,
    #[error("The private player socket path is too long")]
    SocketPathTooLong,
}

/// Directory that holds the private mpv control socket.
///
/// It must be a short, user-only path. `$XDG_RUNTIME_DIR` is per-user, mode
/// 0700, and short; the process temp directory is the fallback. The app cache
/// directory is deliberately not used: its long path pushes the socket past
/// the Unix socket limit, where mpv fails to bind and the only symptom is a
/// control-channel timeout.
pub fn player_runtime_root() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .filter(|root| root.is_dir())
        .unwrap_or_else(std::env::temp_dir)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoOutput {
    Window,
    Null,
    Embedded,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", content = "value", rename_all = "kebab-case")]
pub enum PlayerEvent {
    Ready,
    FileLoaded,
    Playing,
    Paused,
    Position(f64),
    Duration(f64),
    Property { name: String, data: Value },
    Ended(String),
    Idle,
    Failed(String),
}

fn bounded_property_string(value: &Value, maximum: usize) -> Option<Value> {
    value
        .as_str()
        .filter(|value| value.len() <= maximum)
        .map(|value| json!(value))
}

fn safe_track_list(value: &Value) -> Value {
    let Some(tracks) = value.as_array() else {
        return json!([]);
    };
    Value::Array(
        tracks
            .iter()
            .take(128)
            .filter_map(|track| {
                let track = track.as_object()?;
                let track_type = track.get("type")?.as_str()?;
                if !matches!(track_type, "audio" | "sub" | "video") {
                    return None;
                }
                let id = match track.get("id")? {
                    Value::Number(value) if value.as_u64().is_some() => {
                        Value::Number(value.clone())
                    }
                    value => bounded_property_string(value, 32)?,
                };
                let mut safe = serde_json::Map::from_iter([
                    ("type".into(), json!(track_type)),
                    ("id".into(), id),
                ]);
                for name in ["lang", "title", "codec"] {
                    if let Some(value) = track
                        .get(name)
                        .and_then(|value| bounded_property_string(value, 160))
                    {
                        safe.insert(name.into(), value);
                    }
                }
                if let Some(value) = track.get("external").and_then(Value::as_bool) {
                    safe.insert("external".into(), json!(value));
                }
                Some(Value::Object(safe))
            })
            .collect(),
    )
}

fn safe_video_params(value: &Value) -> Value {
    let Some(params) = value.as_object() else {
        return Value::Null;
    };
    let mut safe = serde_json::Map::new();
    for name in ["w", "h", "dw", "dh", "rotate", "max-cll", "max-luma"] {
        if let Some(value) = params.get(name).and_then(Value::as_f64)
            && value.is_finite()
        {
            safe.insert(name.into(), json!(value));
        }
    }
    for name in ["gamma", "primaries", "pixelformat"] {
        if let Some(value) = params
            .get(name)
            .and_then(|value| bounded_property_string(value, 64))
        {
            safe.insert(name.into(), value);
        }
    }
    Value::Object(safe)
}

fn safe_observed_property(name: &str, data: &Value) -> Option<PlayerEvent> {
    let data = match name {
        "paused-for-cache" | "seeking" | "mute" => {
            data.as_bool().map(Value::Bool).unwrap_or(Value::Null)
        }
        "demuxer-cache-time" | "volume" | "speed" | "sub-scale" | "sub-pos" | "sub-delay" => data
            .as_f64()
            .filter(|value| value.is_finite())
            .map(|value| json!(value))
            .unwrap_or(Value::Null),
        "aid" | "sid" => match data {
            Value::Null => Value::Null,
            Value::Number(value) if value.as_u64().is_some() => Value::Number(value.clone()),
            value => bounded_property_string(value, 32)?,
        },
        "track-list" => safe_track_list(data),
        "video-params" => safe_video_params(data),
        _ => return None,
    };
    Some(PlayerEvent::Property {
        name: name.into(),
        data,
    })
}

pub struct MpvSession {
    child: Option<Child>,
    embedded: Option<Arc<EmbeddedMpv>>,
    writer: BufWriter<UnixStream>,
    events: Receiver<PlayerEvent>,
    diagnostic_events: Option<Receiver<Value>>,
    diagnostics: Option<PlaybackDiagnostics>,
    diagnostic_requests: std::collections::HashMap<u64, &'static str>,
    last_diagnostic_sample: Instant,
    session_dir: PathBuf,
    next_request_id: u64,
    subtitle_revision: u64,
    subtitle_files: Vec<PathBuf>,
}

fn session_directory(root: &Path) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let sequence = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
    // Short by design: the control socket built from it must stay under
    // `MAX_SOCKET_PATH_BYTES`.
    root.join(format!("wlp-{}-{stamp}-{sequence}", std::process::id()))
}

fn mpv_arguments(socket_path: &Path, video_output: VideoOutput) -> Vec<String> {
    let mut args = vec![
        "--no-config".into(),
        "--idle=yes".into(),
        "--no-terminal".into(),
        "--really-quiet".into(),
        "--msg-level=all=no".into(),
        format!("--input-ipc-server={}", socket_path.display()),
    ];
    args.extend(
        crate::buffering::OPTIONS
            .iter()
            .map(|(name, value)| format!("--{name}={value}")),
    );
    match video_output {
        VideoOutput::Embedded => unreachable!("embedded playback uses libmpv, not a child window"),
        VideoOutput::Window => args.push("--force-window=yes".into()),
        VideoOutput::Null => {
            args.push("--vo=null".into());
            args.push("--ao=null".into());
        }
    }
    args
}

fn safe_end_reason(value: &Value) -> String {
    match value.get("reason").and_then(Value::as_str) {
        Some("eof") => "eof",
        Some("stop") => "stop",
        Some("quit") => "quit",
        Some("error") => "error",
        Some("redirect") => "redirect",
        _ => "unknown",
    }
    .into()
}

fn event_from_message(value: &Value) -> Option<PlayerEvent> {
    match value.get("event").and_then(Value::as_str)? {
        "file-loaded" => Some(PlayerEvent::FileLoaded),
        "end-file" => Some(PlayerEvent::Ended(safe_end_reason(value))),
        "idle" => Some(PlayerEvent::Idle),
        "shutdown" => Some(PlayerEvent::Idle),
        "property-change" => {
            let name = value.get("name").and_then(Value::as_str)?;
            let data = value.get("data").unwrap_or(&Value::Null);
            match name {
                "pause" if data.as_bool() == Some(true) => Some(PlayerEvent::Paused),
                "pause" if data.as_bool() == Some(false) => Some(PlayerEvent::Playing),
                "time-pos" => data.as_f64().map(PlayerEvent::Position),
                "duration" => data.as_f64().map(PlayerEvent::Duration),
                "core-idle" if data.as_bool() == Some(true) => Some(PlayerEvent::Idle),
                _ => safe_observed_property(name, data),
            }
        }
        _ => None,
    }
}

fn spawn_event_reader(
    stream: UnixStream,
    diagnostic_sender: Option<SyncSender<Value>>,
) -> Receiver<PlayerEvent> {
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let reader = BufReader::new(stream);
        for line in reader.lines() {
            let Ok(line) = line else { break };
            let Ok(value) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if let Some(sender) = &diagnostic_sender {
                let kind = value.get("event").and_then(Value::as_str);
                if matches!(
                    kind,
                    Some("log-message" | "file-loaded" | "end-file" | "idle")
                ) || (kind == Some("property-change")
                    && value.get("name").and_then(Value::as_str) == Some("paused-for-cache"))
                    || value.get("request_id").is_some()
                {
                    let _ = sender.try_send(value.clone());
                }
            }
            if let Some(event) = event_from_message(&value)
                && sender.send(event).is_err()
            {
                break;
            }
        }
    });
    receiver
}

fn public_remote_url(value: &str) -> Result<(), PlayerError> {
    let url = Url::parse(value).map_err(|_| PlayerError::InvalidDescriptor)?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(PlayerError::InvalidDescriptor);
    }
    match url.host().ok_or(PlayerError::InvalidDescriptor)? {
        Host::Domain(host)
            if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") =>
        {
            Err(PlayerError::InvalidDescriptor)
        }
        Host::Ipv4(ip)
            if ip.is_private() || ip.is_loopback() || ip.is_link_local() || ip.is_unspecified() =>
        {
            Err(PlayerError::InvalidDescriptor)
        }
        Host::Ipv6(ip)
            if ip.is_loopback()
                || ip.is_unspecified()
                || (ip.segments()[0] & 0xfe00) == 0xfc00
                || (ip.segments()[0] & 0xffc0) == 0xfe80 =>
        {
            Err(PlayerError::InvalidDescriptor)
        }
        _ => Ok(()),
    }
}

/// Locadora's bundled compatible streaming engine is the only loopback endpoint the
/// player may load from.
///
/// Stremio Video owns the shape of the URLs it hands the shell (torrent info
/// hashes, proxied direct streams, and whatever it adds next), so this checks
/// the origin and the bounds instead of re-deriving that contract. Every path
/// under the official origin is reachable; anything else is not.
fn stremio_service_stream_url(value: &str) -> Result<(), PlayerError> {
    if value.len() > 16_384 {
        return Err(PlayerError::InvalidDescriptor);
    }
    let url = Url::parse(value).map_err(|_| PlayerError::InvalidDescriptor)?;
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port() != Some(11471)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err(PlayerError::InvalidDescriptor);
    }
    let segments = url
        .path_segments()
        .ok_or(PlayerError::InvalidDescriptor)?
        .collect::<Vec<_>>();
    if segments.iter().all(|segment| segment.is_empty())
        || segments
            .iter()
            .any(|segment| matches!(*segment, "." | ".."))
    {
        return Err(PlayerError::InvalidDescriptor);
    }
    Ok(())
}

/// Redacted shape of a rejected descriptor. Never the URL itself: only the
/// scheme, a host class, the port, and the query parameter names.
fn descriptor_shape(value: &str) -> String {
    let Ok(url) = Url::parse(value) else {
        return "unparsable".into();
    };
    let host = match url.host() {
        Some(Host::Domain(host))
            if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") =>
        {
            "loopback-name".to_string()
        }
        Some(Host::Domain(_)) => "public-name".to_string(),
        Some(Host::Ipv4(ip)) if ip.is_loopback() => "loopback".to_string(),
        Some(Host::Ipv4(ip)) if ip.is_private() => "private".to_string(),
        Some(Host::Ipv4(_)) => "public-ip".to_string(),
        Some(Host::Ipv6(ip)) if ip.is_loopback() => "loopback".to_string(),
        Some(Host::Ipv6(_)) => "ipv6".to_string(),
        None => "none".to_string(),
    };
    let mut parameters = url
        .query_pairs()
        .map(|(name, _)| name.to_string())
        .collect::<Vec<_>>();
    parameters.sort();
    parameters.dedup();
    format!(
        "scheme={} host={} port={} segments={} params={}",
        url.scheme(),
        host,
        url.port()
            .map(|port| port.to_string())
            .unwrap_or_else(|| "default".into()),
        url.path_segments().map(Iterator::count).unwrap_or(0),
        if parameters.is_empty() {
            "none".to_string()
        } else {
            parameters.join(",")
        }
    )
}

impl MpvSession {
    pub fn start(runtime_root: &Path, video_output: VideoOutput) -> Result<Self, PlayerError> {
        Self::start_with_diagnostics(runtime_root, video_output, None)
    }

    pub fn start_with_diagnostics(
        runtime_root: &Path,
        video_output: VideoOutput,
        cache_dir: Option<&Path>,
    ) -> Result<Self, PlayerError> {
        let diagnostics_enabled = video_output == VideoOutput::Embedded
            && cache_dir.is_some()
            && std::env::var("LOCADORA_PLAYBACK_DIAGNOSTICS").as_deref() == Ok("1");
        let session_dir = session_directory(runtime_root);
        let socket_path = session_dir.join("mpv.sock");
        // Fail loudly instead of letting mpv bind silently fail and time out.
        if socket_path.as_os_str().len() > MAX_SOCKET_PATH_BYTES {
            return Err(PlayerError::SocketPathTooLong);
        }
        fs::create_dir_all(&session_dir).map_err(|_| PlayerError::ControlUnavailable)?;
        fs::set_permissions(&session_dir, fs::Permissions::from_mode(0o700))
            .map_err(|_| PlayerError::ControlUnavailable)?;
        let embedded = if video_output == VideoOutput::Embedded {
            Some(EmbeddedMpv::new_with_diagnostics(
                &socket_path,
                diagnostics_enabled,
            )?)
        } else {
            None
        };
        let mut child = if embedded.is_none() {
            Some(
                Command::new("mpv")
                    .args(mpv_arguments(&socket_path, video_output))
                    .stdin(Stdio::null())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                    .map_err(|_| PlayerError::Unavailable)?,
            )
        } else {
            None
        };

        let deadline = Instant::now() + CONNECT_TIMEOUT;
        let stream = loop {
            if let Ok(stream) = UnixStream::connect(&socket_path) {
                break stream;
            }
            if child
                .as_mut()
                .map(|child| child.try_wait())
                .transpose()
                .map_err(|_| PlayerError::ControlUnavailable)?
                .flatten()
                .is_some()
                || Instant::now() >= deadline
            {
                if let Some(child) = child.as_mut() {
                    let _ = child.kill();
                }
                let _ = fs::remove_dir_all(&session_dir);
                return Err(PlayerError::ControlUnavailable);
            }
            thread::sleep(Duration::from_millis(25));
        };
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .map_err(|_| PlayerError::ControlUnavailable)?;
        let reader = stream
            .try_clone()
            .map_err(|_| PlayerError::ControlUnavailable)?;
        let (diagnostic_sender, diagnostic_events) = if diagnostics_enabled {
            let (sender, receiver) = mpsc::sync_channel(256);
            (Some(sender), Some(receiver))
        } else {
            (None, None)
        };
        let events = spawn_event_reader(reader, diagnostic_sender);
        let mut session = Self {
            child,
            embedded,
            writer: BufWriter::new(stream),
            events,
            diagnostic_events,
            diagnostics: if diagnostics_enabled {
                cache_dir.map(PlaybackDiagnostics::new)
            } else {
                None
            },
            diagnostic_requests: std::collections::HashMap::new(),
            last_diagnostic_sample: Instant::now(),
            session_dir,
            next_request_id: 1,
            subtitle_revision: 0,
            subtitle_files: Vec::new(),
        };
        for (id, name) in [
            (1, "pause"),
            (2, "time-pos"),
            (3, "duration"),
            (4, "core-idle"),
            (5, "paused-for-cache"),
            (6, "seeking"),
            (7, "demuxer-cache-time"),
            (8, "volume"),
            (9, "mute"),
            (10, "speed"),
            (11, "track-list"),
            (12, "aid"),
            (13, "sid"),
            (14, "sub-scale"),
            (15, "sub-pos"),
            (16, "sub-delay"),
            (17, "video-params"),
        ] {
            session.send_command(vec![json!("observe_property"), json!(id), json!(name)])?;
        }
        if diagnostics_enabled {
            session.send_command(vec![json!("request_log_messages"), json!("warn")])?;
        }
        Ok(session)
    }

    fn send_command(&mut self, command: Vec<Value>) -> Result<(), PlayerError> {
        let request_id = self.next_request_id;
        self.next_request_id += 1;
        let message = json!({ "command": command, "request_id": request_id });
        serde_json::to_writer(&mut self.writer, &message)
            .map_err(|_| PlayerError::CommandFailed)?;
        self.writer
            .write_all(b"\n")
            .map_err(|_| PlayerError::CommandFailed)?;
        self.writer.flush().map_err(|_| PlayerError::CommandFailed)
    }

    pub fn embedded_handle(&self) -> Option<Arc<EmbeddedMpv>> {
        self.embedded.clone()
    }

    fn load_internal(&mut self, descriptor: &str) -> Result<(), PlayerError> {
        self.invalidate_subtitle();
        self.send_command(vec![json!("loadfile"), json!(descriptor), json!("replace")])
    }

    pub fn load_remote(&mut self, descriptor: &str) -> Result<(), PlayerError> {
        if stremio_service_stream_url(descriptor).is_err() {
            public_remote_url(descriptor)
                .map_err(|_| PlayerError::DescriptorRejected(descriptor_shape(descriptor)))?;
        }
        self.load_internal(descriptor)
    }

    pub fn set_paused(&mut self, paused: bool) -> Result<(), PlayerError> {
        self.send_command(vec![json!("set_property"), json!("pause"), json!(paused)])
    }

    pub fn seek_relative(&mut self, seconds: f64) -> Result<(), PlayerError> {
        if !seconds.is_finite() || seconds.abs() > 600.0 {
            return Err(PlayerError::CommandFailed);
        }
        self.send_command(vec![json!("seek"), json!(seconds), json!("relative+exact")])
    }

    pub fn set_property(&mut self, name: &str, value: Value) -> Result<(), PlayerError> {
        let allowed = match name {
            "pause"
            | "mute"
            | "keepaspect"
            | "sub-ass-force-margins"
            | "input-default-bindings"
            | "input-vo-keyboard" => value.is_boolean(),
            "time-pos" => value
                .as_f64()
                .is_some_and(|value| value.is_finite() && value >= 0.0),
            "volume" => value
                .as_f64()
                .is_some_and(|value| value.is_finite() && (0.0..=100.0).contains(&value)),
            "speed" => value
                .as_f64()
                .is_some_and(|value| value.is_finite() && (0.25..=4.0).contains(&value)),
            "sub-delay" => value
                .as_f64()
                .is_some_and(|value| value.is_finite() && (-600.0..=600.0).contains(&value)),
            "sub-scale" => value
                .as_f64()
                .is_some_and(|value| value.is_finite() && (0.1..=10.0).contains(&value)),
            "sub-pos" => value
                .as_f64()
                .is_some_and(|value| value.is_finite() && (0.0..=100.0).contains(&value)),
            "panscan" => value
                .as_f64()
                .is_some_and(|value| value.is_finite() && (0.0..=1.0).contains(&value)),
            "aid" | "sid" => match &value {
                Value::String(value) => value == "no" || value.parse::<u32>().is_ok(),
                Value::Number(value) => {
                    value.as_u64().is_some_and(|value| value <= u32::MAX as u64)
                }
                _ => false,
            },
            "sub-ass-override" => value
                .as_str()
                .is_some_and(|value| matches!(value, "no" | "strip")),
            "hwdec" => value
                .as_str()
                .is_some_and(|value| matches!(value, "no" | "auto" | "auto-copy" | "d3d11va")),
            "osc" => value
                .as_str()
                .is_some_and(|value| matches!(value, "yes" | "no")),
            _ => false,
        };
        if !allowed {
            return Err(PlayerError::CommandFailed);
        }
        self.send_command(vec![json!("set_property"), json!(name), value])
    }

    pub fn stop_media(&mut self) -> Result<(), PlayerError> {
        self.drain_diagnostics();
        if let Some(diagnostics) = &mut self.diagnostics {
            diagnostics.finish();
        }
        self.invalidate_subtitle();
        self.send_command(vec![json!("stop")])
    }

    fn invalidate_subtitle(&mut self) -> u64 {
        self.subtitle_revision = SESSION_COUNTER.fetch_add(1, Ordering::Relaxed);
        self.subtitle_revision
    }

    pub fn begin_subtitle(&mut self) -> Result<u64, PlayerError> {
        let revision = self.invalidate_subtitle();
        self.set_property("sid", json!("no"))?;
        self.set_property("sub-delay", json!(0))?;
        Ok(revision)
    }

    pub fn attach_subtitle(&mut self, revision: u64, bytes: &[u8]) -> Result<(), PlayerError> {
        if revision != self.subtitle_revision || bytes.len() > 2 * 1024 * 1024 {
            return Err(PlayerError::CommandFailed);
        }
        // Only downloaded bounded bytes enter this private directory. No caller
        // controls a local path or passes a subtitle URL to mpv.
        let path = self.session_dir.join(format!("subtitle-{revision}.sub"));
        fs::write(&path, bytes).map_err(|_| PlayerError::CommandFailed)?;
        self.subtitle_files.push(path.clone());
        if self.subtitle_files.len() > 16 {
            let expired = self.subtitle_files.remove(0);
            let _ = fs::remove_file(expired);
        }
        self.send_command(vec![
            json!("sub-add"),
            json!(path),
            json!("select"),
            json!("Locadora external"),
        ])
    }

    pub fn drain_events(&mut self) -> Vec<PlayerEvent> {
        self.drain_diagnostics();
        self.events.try_iter().take(100).collect()
    }

    fn drain_diagnostics(&mut self) {
        let Some(receiver) = &self.diagnostic_events else {
            return;
        };
        let messages = receiver.try_iter().take(256).collect::<Vec<_>>();
        for message in messages {
            match message.get("event").and_then(Value::as_str) {
                Some("file-loaded") => {
                    if let Some(diag) = &mut self.diagnostics {
                        diag.start(SESSION_COUNTER.fetch_add(1, Ordering::Relaxed));
                    }
                    self.last_diagnostic_sample = Instant::now() - Duration::from_secs(1);
                }
                Some("end-file" | "idle") => {
                    if let Some(diag) = &mut self.diagnostics {
                        diag.finish();
                    }
                }
                Some("log-message") => {
                    if let Some(diag) = &mut self.diagnostics {
                        diag.log(&message);
                    }
                }
                Some("property-change") => {
                    if let Some(diag) = &mut self.diagnostics {
                        diag.sample(
                            "paused-for-cache",
                            message.get("data").unwrap_or(&Value::Null),
                        );
                    }
                }
                _ => {
                    if let Some(id) = message.get("request_id").and_then(Value::as_u64)
                        && let Some(name) = self.diagnostic_requests.remove(&id)
                        && let Some(diag) = &mut self.diagnostics
                    {
                        diag.sample(name, message.get("data").unwrap_or(&Value::Null));
                    }
                }
            }
        }
        if self
            .diagnostics
            .as_ref()
            .is_some_and(PlaybackDiagnostics::is_active)
            && self.last_diagnostic_sample.elapsed() >= Duration::from_secs(1)
        {
            self.last_diagnostic_sample = Instant::now();
            for &name in DIAGNOSTIC_PROPERTIES {
                let id = self.next_request_id;
                if self
                    .send_command(vec![json!("get_property"), json!(name)])
                    .is_ok()
                {
                    self.diagnostic_requests.insert(id, name);
                }
            }
            if let Some(diag) = &self.diagnostics {
                diag.flush();
            }
        }
    }

    pub fn is_alive(&mut self) -> bool {
        self.embedded.is_some()
            || self
                .child
                .as_mut()
                .is_some_and(|child| matches!(child.try_wait(), Ok(None)))
    }
}

impl Drop for MpvSession {
    fn drop(&mut self) {
        self.drain_diagnostics();
        if let Some(diag) = &mut self.diagnostics {
            diag.finish();
        }
        if self.embedded.is_some() {
            // The UI must free the GL render context before dropping this owner.
            self.embedded.take();
            let _ = fs::remove_dir_all(&self.session_dir);
            return;
        }
        let _ = self.send_command(vec![json!("quit")]);
        let deadline = Instant::now() + Duration::from_millis(600);
        while Instant::now() < deadline {
            if !self.is_alive() {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }
        if self.is_alive()
            && let Some(child) = self.child.as_mut()
        {
            let _ = child.kill();
            let _ = child.wait();
        }
        let _ = fs::remove_dir_all(&self.session_dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn launch_arguments_never_contain_a_media_descriptor() {
        let args = mpv_arguments(Path::new("/tmp/private/mpv.sock"), VideoOutput::Window);
        assert!(
            args.iter()
                .all(|argument| !argument.contains("http") && !argument.contains("lavfi"))
        );
        assert!(
            args.iter()
                .any(|argument| argument.starts_with("--input-ipc-server="))
        );
    }

    #[test]
    fn control_socket_paths_stay_under_the_unix_socket_limit() {
        // The desktop app built this socket under its long app cache directory,
        // where mpv cannot bind it at all: the only symptom was a
        // control-channel timeout and a window that opened then closed.
        for root in [player_runtime_root(), std::env::temp_dir()] {
            let socket = session_directory(&root).join("mpv.sock");
            assert!(
                socket.as_os_str().len() <= MAX_SOCKET_PATH_BYTES,
                "socket path is {} bytes: {}",
                socket.as_os_str().len(),
                socket.display()
            );
        }
    }

    #[test]
    fn over_long_socket_roots_are_rejected_before_mpv_starts() {
        let root = std::env::temp_dir().join("x".repeat(MAX_SOCKET_PATH_BYTES));
        assert!(matches!(
            MpvSession::start(&root, VideoOutput::Null),
            Err(PlayerError::SocketPathTooLong)
        ));
    }

    #[test]
    fn remote_descriptors_are_protocol_and_network_bounded() {
        assert!(public_remote_url("https://media.example.com/video.mp4?token=secret").is_ok());
        for value in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "http://127.0.0.1/private",
            "http://[::1]/private",
            "http://localhost/private",
            "https://user:password@media.example.com/video",
        ] {
            assert!(public_remote_url(value).is_err(), "accepted {value}");
        }
    }

    #[test]
    fn the_official_service_origin_is_the_only_loopback_endpoint_allowed() {
        let hash = "a".repeat(40);
        // Stremio Video owns the URL shapes it hands the shell: torrent info
        // hashes, proxied direct streams, and whatever it adds next. Only the
        // official origin is checked, so a new shape cannot break playback.
        for value in [
            format!("http://127.0.0.1:11471/{hash}/7?tr=udp%3A%2F%2Ftracker.example"),
            "http://127.0.0.1:11471/proxy/d=https%3A%2F%2Fmedia.example.com&h=User-Agent%3Aok/movie.mkv"
                .to_string(),
            "http://127.0.0.1:11471/subtitles.vtt?from=https%3A%2F%2Fmedia.example.com%2Fa.srt"
                .to_string(),
            format!("http://127.0.0.1:11471/{hash}/7/stats.json"),
        ] {
            assert!(
                stremio_service_stream_url(&value).is_ok(),
                "rejected {value}"
            );
        }
        // The URL parser normalizes `..` away before this runs, so a traversal
        // attempt lands on a plain path of the same allowed origin.
        assert!(
            stremio_service_stream_url(&format!("http://127.0.0.1:11471/{hash}/../settings"))
                .is_ok()
        );
        for value in [
            format!("http://localhost:11471/{hash}/7"),
            format!("http://127.0.0.1:11470/{hash}/7"),
            format!("http://127.0.0.1:11472/{hash}/7"),
            "https://127.0.0.1:11471/stream".to_string(),
            "http://127.0.0.1:11471/".to_string(),
            format!("http://user:password@127.0.0.1:11471/{hash}/7"),
            "http://[::1]:11471/stream".to_string(),
        ] {
            assert!(
                stremio_service_stream_url(&value).is_err(),
                "accepted {value}"
            );
        }
    }

    #[test]
    fn rejected_descriptor_shapes_never_carry_the_url() {
        let shape = descriptor_shape(
            "https://user:password@media.example.com/private/video.mp4?token=secret",
        );
        assert!(shape.contains("scheme=https"));
        assert!(shape.contains("host=public-name"));
        assert!(
            shape.contains("params=token"),
            "parameter names are kept on purpose: {shape}"
        );
        for secret in ["media.example.com", "private", "password", "secret"] {
            assert!(!shape.contains(secret), "shape leaked {secret}: {shape}");
        }
    }

    #[test]
    fn event_parser_emits_only_allowlisted_data() {
        assert_eq!(
            event_from_message(&json!({ "event": "file-loaded" })),
            Some(PlayerEvent::FileLoaded)
        );
        assert_eq!(
            event_from_message(
                &json!({ "event": "end-file", "reason": "error", "file_error": "secret" })
            ),
            Some(PlayerEvent::Ended("error".into()))
        );
        assert_eq!(
            event_from_message(&json!({ "event": "log-message", "text": "secret" })),
            None
        );
        assert_eq!(
            event_from_message(&json!({
                "event": "property-change",
                "name": "track-list",
                "data": [{
                    "type": "sub",
                    "id": 2,
                    "lang": "por",
                    "codec": "ass",
                    "external": true,
                    "external-filename": "/private/token.srt",
                    "decoder-desc": "not allowlisted"
                }]
            })),
            Some(PlayerEvent::Property {
                name: "track-list".into(),
                data: json!([{
                    "type": "sub",
                    "id": 2,
                    "lang": "por",
                    "codec": "ass",
                    "external": true
                }])
            })
        );
        assert_eq!(
            event_from_message(&json!({
                "event": "property-change",
                "name": "metadata",
                "data": {"private": "secret"}
            })),
            None
        );
    }

    #[test]
    fn property_commands_are_deny_by_default() {
        fn allowed(name: &str, value: Value) -> bool {
            let mut session =
                MpvSession::start(&player_runtime_root(), VideoOutput::Null).expect("start mpv");
            session.set_property(name, value).is_ok()
        }

        if !crate::probe_mpv().available {
            return;
        }
        assert!(allowed("pause", json!(true)));
        assert!(allowed("sub-delay", json!(1.25)));
        assert!(!allowed("script-opts", json!("danger")));
        assert!(!allowed("sub-delay", json!(601)));
    }

    #[test]
    fn mpv_private_ipc_smoke_test() {
        if !crate::probe_mpv().available {
            assert!(
                std::env::var_os("LOCADORA_REQUIRE_MPV_SMOKE").is_none(),
                "mpv is required for this test"
            );
            return;
        }
        let mut session =
            MpvSession::start(&player_runtime_root(), VideoOutput::Null).expect("start mpv");
        session
            .load_internal("av://lavfi:testsrc=duration=0.2:size=64x64:rate=10")
            .expect("load internal test source");
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut loaded = false;
        let mut ended = false;
        while Instant::now() < deadline && !ended {
            for event in session.drain_events() {
                loaded |= event == PlayerEvent::FileLoaded;
                ended |= matches!(event, PlayerEvent::Ended(_));
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(loaded, "mpv did not report file-loaded");
        assert!(ended, "mpv did not report end-file");
    }

    #[test]
    fn native_subtitle_selection_and_delay_reach_mpv() {
        if !crate::probe_mpv().available {
            return;
        }
        let mut session =
            MpvSession::start(&player_runtime_root(), VideoOutput::Null).expect("start mpv");
        session
            .load_internal("av://lavfi:testsrc=duration=20:size=64x64:rate=10")
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut loaded = false;
        while Instant::now() < deadline && !loaded {
            loaded = session.drain_events().contains(&PlayerEvent::FileLoaded);
            thread::sleep(Duration::from_millis(20));
        }
        assert!(loaded);
        session.set_paused(true).unwrap();
        let old = session.begin_subtitle().unwrap();
        let revision = session.begin_subtitle().unwrap();
        let subtitle = b"1\n00:00:00,000 --> 00:00:10,000\nSynthetic subtitle fixture\n";
        assert!(session.attach_subtitle(old, subtitle).is_err());
        session.attach_subtitle(revision, subtitle).unwrap();
        session.set_property("sub-delay", json!(-1.5)).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut selected = false;
        let mut delay = false;
        let mut track = false;
        while Instant::now() < deadline && !(selected && delay && track) {
            for event in session.drain_events() {
                if let PlayerEvent::Property { name, data } = event {
                    selected |= name == "sid" && data.as_u64().is_some_and(|id| id > 0);
                    delay |= name == "sub-delay" && data.as_f64() == Some(-1.5);
                    track |= name == "track-list"
                        && data.as_array().is_some_and(|tracks| {
                            tracks
                                .iter()
                                .any(|track| track["title"] == "Locadora external")
                        });
                }
            }
            thread::sleep(Duration::from_millis(20));
        }
        assert!(
            selected && delay && track,
            "subtitle selection/delay did not reach mpv"
        );
        session.stop_media().unwrap();
        assert!(session.attach_subtitle(revision, subtitle).is_err());
    }

    #[test]
    fn embedded_session_uses_libmpv_without_a_child_window() {
        if !crate::probe_mpv().available {
            return;
        }
        let mut session = MpvSession::start(&player_runtime_root(), VideoOutput::Embedded)
            .expect("start embedded libmpv");
        assert!(session.embedded_handle().is_some());
        assert!(session.child.is_none());
        assert!(session.is_alive());
    }
}
