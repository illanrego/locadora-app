//! Opt-in, bounded rented-tape diagnostics.
//!
//! Dynamic strings cross one redaction function before serialization. The
//! event writer never accepts a pre-rendered line, URL, path, tracker or magnet.
use serde::Deserialize;
use serde_json::{Map, Value};
use std::{
    ffi::OsStr,
    fs,
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{ChildStderr, ChildStdout},
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State};

pub const FLAG: &str = "LOCADORA_TAPE_DIAGNOSTICS";
pub const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
const ENGINE_CAP_LINE: &[u8] =
    b"\n[locadora] tape engine diagnostics capped at 2097152 bytes; further output discarded\n";
const EVENT_CAP_EVENT: &str = "log-capped";
const EVENT_CAP_REASON: &str = "size-cap";

pub fn enabled() -> bool {
    enabled_from(std::env::var_os(FLAG).as_deref())
}

fn enabled_from(value: Option<&OsStr>) -> bool {
    value == Some(OsStr::new("1"))
}

fn private_dir(path: &Path) -> std::io::Result<()> {
    fs::create_dir_all(path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

struct CappedFile {
    file: fs::File,
    bytes: usize,
    capped: bool,
    closing_line: Vec<u8>,
    preserve_lines: bool,
}

impl CappedFile {
    fn create(path: &Path, closing_line: Vec<u8>, preserve_lines: bool) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            private_dir(parent)?;
        }
        let file = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .mode(0o600)
            .open(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            file,
            bytes: 0,
            capped: false,
            closing_line,
            preserve_lines,
        })
    }

    fn append(&mut self, bytes: &[u8]) {
        if self.capped || bytes.is_empty() {
            return;
        }
        let content_limit = MAX_FILE_BYTES.saturating_sub(self.closing_line.len());
        if self.bytes.saturating_add(bytes.len()) <= content_limit {
            if self.file.write_all(bytes).is_ok() {
                self.bytes += bytes.len();
            }
            return;
        }
        if !self.preserve_lines {
            let remaining = content_limit.saturating_sub(self.bytes);
            if remaining > 0 && self.file.write_all(&bytes[..remaining]).is_ok() {
                self.bytes += remaining;
            }
        }
        if self.file.write_all(&self.closing_line).is_ok() {
            self.bytes += self.closing_line.len();
        }
        let _ = self.file.flush();
        self.capped = true;
    }
}

pub struct EngineLogThreads {
    threads: Vec<thread::JoinHandle<()>>,
}

impl EngineLogThreads {
    pub fn join(self) {
        for thread in self.threads {
            let _ = thread.join();
        }
    }
}

fn redact_hex_runs(token: &str) -> String {
    let bytes = token.as_bytes();
    let mut output = String::new();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index].is_ascii_hexdigit() {
            let start = index;
            while index < bytes.len() && bytes[index].is_ascii_hexdigit() {
                index += 1;
            }
            if index - start >= 40 {
                output.push_str(&token[start..start + 8].to_ascii_lowercase());
                output.push_str("[redacted]");
            } else {
                output.push_str(&token[start..index]);
            }
        } else {
            let character = token[index..].chars().next().unwrap_or('\u{fffd}');
            output.push(character);
            index += character.len_utf8();
        }
    }
    output
}

/// Keeps engine-owned context while removing the values forbidden in every
/// diagnostic file. No raw child string is written without passing here.
fn redact_engine_line(raw: &[u8]) -> Vec<u8> {
    const SENSITIVE: &[&str] = &[
        "://",
        "magnet:",
        "tracker",
        "authorization",
        "credential",
        "password",
        "cookie",
        "token",
        "secret",
        "api-key",
        "api_key",
    ];
    let decoded = String::from_utf8_lossy(raw);
    let mut output = String::new();
    for (index, token) in decoded.split_whitespace().take(256).enumerate() {
        if index > 0 {
            output.push(' ');
        }
        let lower = token.to_ascii_lowercase();
        let media_name = [".mkv", ".mp4", ".avi", ".webm"]
            .iter()
            .any(|extension| lower.contains(extension));
        if SENSITIVE.iter().any(|marker| lower.contains(marker))
            || token.contains('/')
            || token.contains('@')
            || media_name
        {
            output.push_str("[redacted]");
        } else {
            output.push_str(&redact_hex_runs(token));
        }
        if output.len() >= 4096 {
            output.truncate(4096);
            break;
        }
    }
    output.push('\n');
    output.into_bytes()
}

fn append_engine_line(sink: &Option<Arc<Mutex<CappedFile>>>, raw: &[u8]) {
    if let Some(sink) = sink
        && let Ok(mut sink) = sink.lock()
    {
        sink.append(&redact_engine_line(raw));
    }
}

fn drain<R: Read + Send + 'static>(mut reader: R, sink: Option<Arc<Mutex<CappedFile>>>) {
    let mut bytes = [0_u8; 8192];
    let mut pending = Vec::new();
    loop {
        match reader.read(&mut bytes) {
            Ok(0) | Err(_) => {
                if !pending.is_empty() {
                    append_engine_line(&sink, &pending);
                }
                return;
            }
            Ok(read) => {
                pending.extend_from_slice(&bytes[..read]);
                while let Some(newline) = pending.iter().position(|byte| *byte == b'\n') {
                    let line = pending.drain(..=newline).collect::<Vec<_>>();
                    append_engine_line(&sink, &line);
                }
                if pending.len() > 16 * 1024 {
                    append_engine_line(&sink, &pending);
                    pending.clear();
                }
            }
        }
    }
}

/// Starts two drainers sharing one capped file. Failure to open the file still
/// drains both pipes, so diagnostics can never block the engine process.
pub fn start_engine_log(
    path: &Path,
    stdout: Option<ChildStdout>,
    stderr: Option<ChildStderr>,
) -> EngineLogThreads {
    let sink = CappedFile::create(path, ENGINE_CAP_LINE.to_vec(), false)
        .ok()
        .map(|file| Arc::new(Mutex::new(file)));
    let mut threads = Vec::new();
    if let Some(stdout) = stdout {
        let sink = sink.clone();
        threads.push(thread::spawn(move || drain(stdout, sink)));
    }
    if let Some(stderr) = stderr {
        threads.push(thread::spawn(move || drain(stderr, sink)));
    }
    EngineLogThreads { threads }
}

pub fn engine_log_path(cache_root: &Path, pid: u32) -> PathBuf {
    cache_root
        .join("diagnostics")
        .join(format!("tape-engine-{pid}.log"))
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TapeState {
    Queued,
    Resolving,
    Downloading,
    Ready,
    Seeding,
    Failed,
    Returned,
    Unverified,
}

impl TapeState {
    fn token(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Resolving => "resolving",
            Self::Downloading => "downloading",
            Self::Ready => "ready",
            Self::Seeding => "seeding",
            Self::Failed => "failed",
            Self::Returned => "returned",
            Self::Unverified => "unverified",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TapeReason {
    TapesDisabled,
    RentalUnreadable,
    SeriesOutOfScope,
    TitleUnmapped,
    NoQualifyingSource,
    NotATorrent,
    InvalidSource,
    UnknownFileIndex,
    UnknownSize,
    AlreadyQueued,
    CapExceeded,
    CountExceeded,
    SpaceExceeded,
    InvalidRow,
    ManifestWriteFailed,
    MediaFailure,
    EngineUnavailable,
    TorrentNotFound,
    InvalidRequest,
    ReadFailed,
    TooLarge,
    Cancelled,
    RegistrationRefused,
    ManifestUnreadable,
}

impl TapeReason {
    fn token(self) -> &'static str {
        match self {
            Self::TapesDisabled => "tapes-disabled",
            Self::RentalUnreadable => "rental-unreadable",
            Self::SeriesOutOfScope => "series-out-of-scope",
            Self::TitleUnmapped => "title-unmapped",
            Self::NoQualifyingSource => "no-qualifying-source",
            Self::NotATorrent => "not-a-torrent",
            Self::InvalidSource => "invalid-source",
            Self::UnknownFileIndex => "unknown-file-index",
            Self::UnknownSize => "unknown-size",
            Self::AlreadyQueued => "already-queued",
            Self::CapExceeded => "cap-exceeded",
            Self::CountExceeded => "count-exceeded",
            Self::SpaceExceeded => "space-exceeded",
            Self::InvalidRow => "invalid-row",
            Self::ManifestWriteFailed => "manifest-write-failed",
            Self::MediaFailure => "media-failure",
            Self::EngineUnavailable => "engine-unavailable",
            Self::TorrentNotFound => "torrent-not-found",
            Self::InvalidRequest => "invalid-request",
            Self::ReadFailed => "read-failed",
            Self::TooLarge => "too-large",
            Self::Cancelled => "cancelled",
            Self::RegistrationRefused => "registration-refused",
            Self::ManifestUnreadable => "manifest-unreadable",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlaybackCause {
    RamPlayback,
    Idle,
}

impl PlaybackCause {
    fn token(self) -> &'static str {
        match self {
            Self::RamPlayback => "ram-playback",
            Self::Idle => "idle",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RemoveStatus {
    Removed,
    EngineUnavailable,
    RemoveRejected,
}

impl RemoveStatus {
    fn token(self) -> &'static str {
        match self {
            Self::Removed => "removed",
            Self::EngineUnavailable => "engine-unavailable",
            Self::RemoveRejected => "remove-rejected",
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StateCounts {
    queued: u32,
    resolving: u32,
    downloading: u32,
    ready: u32,
    seeding: u32,
    failed: u32,
    returned: u32,
    unverified: u32,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "event",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum TapeEvent {
    Enqueue {
        content_id: String,
        size_bytes: u64,
        info_hash: Option<String>,
    },
    AdmitRefused {
        content_id: Option<String>,
        info_hash: Option<String>,
        reason: TapeReason,
    },
    Ensure {
        info_hash: Option<String>,
    },
    Create {
        info_hash: String,
        http_status: u16,
    },
    DownloadStart {
        info_hash: String,
    },
    DownloadComplete {
        info_hash: String,
        state: TapeState,
    },
    SeedObserved {
        info_hash: String,
        state: TapeState,
    },
    DownloadFailed {
        info_hash: String,
        reason: TapeReason,
    },
    Pause {
        cause: PlaybackCause,
    },
    Resume {
        cause: PlaybackCause,
    },
    Return {
        info_hash: String,
        remove_status: RemoveStatus,
    },
    Hydration {
        registered: u32,
        requeued: u32,
        unverified: u32,
        refused: u32,
    },
    HydrateSummary {
        state_counts: StateCounts,
    },
}

enum RedactedField {
    ContentId,
    InfoHash,
}

/// The only route for a dynamic string into a tape event line.
fn redact(field: RedactedField, value: &str) -> Option<String> {
    match field {
        RedactedField::ContentId => {
            let parts = value.split(':').collect::<Vec<_>>();
            let (kind, id) = match parts.as_slice() {
                [kind, id] => (*kind, *id),
                [kind, "tmdb", id] => (*kind, *id),
                _ => return None,
            };
            (matches!(kind, "movie" | "series")
                && (1..=20).contains(&id.len())
                && id.bytes().all(|byte| byte.is_ascii_digit()))
            .then(|| {
                if parts.len() == 3 {
                    format!("{kind}:tmdb:{id}")
                } else {
                    format!("{kind}:{id}")
                }
            })
        }
        RedactedField::InfoHash => (value.len() == 40
            && value.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .then(|| value[..8].to_ascii_lowercase()),
    }
}

fn insert_string(map: &mut Map<String, Value>, key: &str, value: &'static str) {
    map.insert(key.into(), Value::String(value.into()));
}

fn insert_redacted(map: &mut Map<String, Value>, key: &str, field: RedactedField, value: &str) {
    if let Some(value) = redact(field, value) {
        map.insert(key.into(), Value::String(value));
    }
}

fn iso_timestamp() -> String {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = duration.as_secs() as libc::time_t;
    let mut broken_down = std::mem::MaybeUninit::<libc::tm>::uninit();
    // SAFETY: both pointers are valid for the duration of the call.
    let ok = unsafe { libc::gmtime_r(&seconds, broken_down.as_mut_ptr()) };
    if ok.is_null() {
        return "1970-01-01T00:00:00.000Z".into();
    }
    // SAFETY: gmtime_r returned non-null and initialized the value.
    let broken_down = unsafe { broken_down.assume_init() };
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.{:03}Z",
        broken_down.tm_year + 1900,
        broken_down.tm_mon + 1,
        broken_down.tm_mday,
        broken_down.tm_hour,
        broken_down.tm_min,
        broken_down.tm_sec,
        duration.subsec_millis()
    )
}

fn state_counts_value(counts: StateCounts) -> Value {
    serde_json::json!({
        "queued": counts.queued,
        "resolving": counts.resolving,
        "downloading": counts.downloading,
        "ready": counts.ready,
        "seeding": counts.seeding,
        "failed": counts.failed,
        "returned": counts.returned,
        "unverified": counts.unverified,
    })
}

fn event_line(event: TapeEvent) -> Vec<u8> {
    let mut map = Map::new();
    map.insert("timestamp".into(), Value::String(iso_timestamp()));
    match event {
        TapeEvent::Enqueue {
            content_id,
            size_bytes,
            info_hash,
        } => {
            insert_string(&mut map, "event", "enqueue");
            insert_redacted(&mut map, "contentId", RedactedField::ContentId, &content_id);
            map.insert("sizeBytes".into(), size_bytes.into());
            if let Some(hash) = info_hash {
                insert_redacted(&mut map, "infoHash", RedactedField::InfoHash, &hash);
            }
        }
        TapeEvent::AdmitRefused {
            content_id,
            info_hash,
            reason,
        } => {
            insert_string(&mut map, "event", "admit-refused");
            if let Some(content_id) = content_id {
                insert_redacted(&mut map, "contentId", RedactedField::ContentId, &content_id);
            }
            if let Some(hash) = info_hash {
                insert_redacted(&mut map, "infoHash", RedactedField::InfoHash, &hash);
            }
            insert_string(&mut map, "reason", reason.token());
        }
        TapeEvent::Ensure { info_hash } => {
            insert_string(&mut map, "event", "ensure");
            if let Some(hash) = info_hash {
                insert_redacted(&mut map, "infoHash", RedactedField::InfoHash, &hash);
            }
        }
        TapeEvent::Create {
            info_hash,
            http_status,
        } => {
            insert_string(&mut map, "event", "create");
            insert_redacted(&mut map, "infoHash", RedactedField::InfoHash, &info_hash);
            map.insert("httpStatus".into(), http_status.into());
        }
        TapeEvent::DownloadStart { info_hash } => {
            insert_string(&mut map, "event", "download-start");
            insert_redacted(&mut map, "infoHash", RedactedField::InfoHash, &info_hash);
        }
        TapeEvent::DownloadComplete { info_hash, state } => {
            insert_string(&mut map, "event", "download-complete");
            insert_redacted(&mut map, "infoHash", RedactedField::InfoHash, &info_hash);
            insert_string(&mut map, "state", state.token());
        }
        TapeEvent::SeedObserved { info_hash, state } => {
            insert_string(&mut map, "event", "seed-observed");
            insert_redacted(&mut map, "infoHash", RedactedField::InfoHash, &info_hash);
            insert_string(&mut map, "state", state.token());
        }
        TapeEvent::DownloadFailed { info_hash, reason } => {
            insert_string(&mut map, "event", "download-failed");
            insert_redacted(&mut map, "infoHash", RedactedField::InfoHash, &info_hash);
            insert_string(&mut map, "reason", reason.token());
        }
        TapeEvent::Pause { cause } => {
            insert_string(&mut map, "event", "pause");
            insert_string(&mut map, "cause", cause.token());
        }
        TapeEvent::Resume { cause } => {
            insert_string(&mut map, "event", "resume");
            insert_string(&mut map, "cause", cause.token());
        }
        TapeEvent::Return {
            info_hash,
            remove_status,
        } => {
            insert_string(&mut map, "event", "return");
            insert_redacted(&mut map, "infoHash", RedactedField::InfoHash, &info_hash);
            insert_string(&mut map, "removeStatus", remove_status.token());
        }
        TapeEvent::Hydration {
            registered,
            requeued,
            unverified,
            refused,
        } => {
            insert_string(&mut map, "event", "hydration");
            map.insert("registered".into(), registered.into());
            map.insert("requeued".into(), requeued.into());
            map.insert("unverified".into(), unverified.into());
            map.insert("refused".into(), refused.into());
        }
        TapeEvent::HydrateSummary { state_counts } => {
            insert_string(&mut map, "event", "hydrate-summary");
            map.insert("stateCounts".into(), state_counts_value(state_counts));
        }
    }
    let mut line = serde_json::to_vec(&Value::Object(map)).expect("safe tape event serializes");
    line.push(b'\n');
    line
}

fn event_cap_line() -> Vec<u8> {
    let mut map = Map::new();
    map.insert("timestamp".into(), Value::String(iso_timestamp()));
    insert_string(&mut map, "event", EVENT_CAP_EVENT);
    insert_string(&mut map, "reason", EVENT_CAP_REASON);
    let mut line = serde_json::to_vec(&Value::Object(map)).expect("cap event serializes");
    line.push(b'\n');
    line
}

pub struct TapeDiagnosticsState {
    enabled: bool,
    session: String,
    events: Mutex<Option<CappedFile>>,
}

impl Default for TapeDiagnosticsState {
    fn default() -> Self {
        Self::new(enabled())
    }
}

impl TapeDiagnosticsState {
    fn new(enabled: bool) -> Self {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        Self {
            enabled,
            session: format!("{}-{millis}", std::process::id()),
            events: Mutex::new(None),
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn record(&self, cache_root: &Path, event: TapeEvent) {
        if !self.enabled {
            return;
        }
        let Ok(mut events) = self.events.lock() else {
            return;
        };
        if events.is_none() {
            let path = cache_root
                .join("diagnostics")
                .join(format!("tape-events-{}.jsonl", self.session));
            *events = CappedFile::create(&path, event_cap_line(), true).ok();
        }
        if let Some(events) = events.as_mut() {
            events.append(&event_line(event));
        }
    }
}

pub fn record(app: &AppHandle, event: TapeEvent) {
    let state = app.state::<TapeDiagnosticsState>();
    if !state.is_enabled() {
        return;
    }
    if let Ok(cache_root) = app.path().app_cache_dir() {
        state.record(&cache_root, event);
    }
}

#[tauri::command]
pub fn tape_diagnostics_enabled(state: State<'_, TapeDiagnosticsState>) -> bool {
    state.is_enabled()
}

#[tauri::command]
pub fn tape_diagnostics_append(app: AppHandle, event: TapeEvent) {
    record(&app, event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_ID: AtomicU64 = AtomicU64::new(1);

    fn root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "locadora-tape-diagnostics-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        root
    }

    fn only_file(root: &Path, prefix: &str) -> PathBuf {
        fs::read_dir(root.join("diagnostics"))
            .unwrap()
            .flatten()
            .map(|entry| entry.path())
            .find(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with(prefix))
            })
            .unwrap()
    }

    #[test]
    fn exact_flag_value_only() {
        assert!(enabled_from(Some(OsStr::new("1"))));
        for value in [
            None,
            Some(OsStr::new("")),
            Some(OsStr::new("0")),
            Some(OsStr::new("true")),
            Some(OsStr::new("01")),
        ] {
            assert!(!enabled_from(value));
        }
    }

    #[test]
    fn no_file_when_flag_is_off() {
        let root = root();
        let diagnostics = TapeDiagnosticsState::new(enabled_from(None));
        diagnostics.record(
            &root,
            TapeEvent::Enqueue {
                content_id: "movie:1".into(),
                size_bytes: 3,
                info_hash: Some("a".repeat(40)),
            },
        );
        assert!(!root.join("diagnostics").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn event_lines_are_json_redacted_and_private() {
        let root = root();
        let diagnostics = TapeDiagnosticsState::new(true);
        let full_hash = "0123456789abcdef0123456789abcdef01234567";
        diagnostics.record(
            &root,
            TapeEvent::Enqueue {
                content_id: "movie:tmdb:7".into(),
                size_bytes: 734_003_200,
                info_hash: Some(full_hash.into()),
            },
        );
        diagnostics.record(
            &root,
            TapeEvent::AdmitRefused {
                content_id: Some(
                    "https://user:credential@tracker.invalid/magnet:?xt=secret".into(),
                ),
                info_hash: Some(full_hash.into()),
                reason: TapeReason::CapExceeded,
            },
        );
        diagnostics.record(
            &root,
            TapeEvent::DownloadStart {
                info_hash: full_hash.into(),
            },
        );
        diagnostics.record(
            &root,
            TapeEvent::DownloadComplete {
                info_hash: full_hash.into(),
                state: TapeState::Ready,
            },
        );
        let path = only_file(&root, "tape-events-");
        let output = fs::read_to_string(&path).unwrap();
        let lines = output.lines().collect::<Vec<_>>();
        assert_eq!(lines.len(), 4);
        assert!(
            lines
                .iter()
                .all(|line| serde_json::from_str::<Value>(line).is_ok())
        );
        assert!(output.contains("01234567"));
        assert!(output.contains("movie:tmdb:7"));
        for forbidden in [
            full_hash,
            "https://",
            "tracker.invalid",
            "magnet:",
            "credential",
            "secret",
        ] {
            assert!(!output.contains(forbidden), "leaked {forbidden}");
        }
        assert_eq!(
            fs::metadata(root.join("diagnostics"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600
        );
        println!("P9_SAMPLE_BEGIN\n{}P9_SAMPLE_END", output);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn event_and_engine_files_stop_at_the_cap_once() {
        let root = root();
        let events_path = root.join("diagnostics/tape-events-test.jsonl");
        let cap_line = event_cap_line();
        let mut events = CappedFile::create(&events_path, cap_line.clone(), true).unwrap();
        let event = event_line(TapeEvent::Hydration {
            registered: 1,
            requeued: 2,
            unverified: 3,
            refused: 4,
        });
        while events.bytes + event.len() <= MAX_FILE_BYTES - cap_line.len() {
            events.append(&event);
        }
        events.append(&event);
        let event_len = fs::metadata(&events_path).unwrap().len() as usize;
        let event_output = fs::read_to_string(&events_path).unwrap();
        assert!(event_len <= MAX_FILE_BYTES);
        assert_eq!(event_output.matches("\"event\":\"log-capped\"").count(), 1);
        assert!(
            event_output
                .lines()
                .all(|line| serde_json::from_str::<Value>(line).is_ok())
        );
        events.append(&event);
        assert_eq!(
            fs::metadata(&events_path).unwrap().len() as usize,
            event_len
        );

        let engine_path = root.join("diagnostics/tape-engine-1.log");
        let mut engine = CappedFile::create(&engine_path, ENGINE_CAP_LINE.to_vec(), false).unwrap();
        engine.append(&vec![b'x'; MAX_FILE_BYTES * 2]);
        let engine_len = fs::metadata(&engine_path).unwrap().len() as usize;
        let engine_output = fs::read(&engine_path).unwrap();
        assert_eq!(engine_len, MAX_FILE_BYTES);
        assert_eq!(
            engine_output
                .windows(ENGINE_CAP_LINE.len())
                .filter(|window| *window == ENGINE_CAP_LINE)
                .count(),
            1
        );
        engine.append(b"more");
        assert_eq!(
            fs::metadata(&engine_path).unwrap().len() as usize,
            engine_len
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn engine_output_redactor_blocks_urls_trackers_paths_credentials_and_full_hashes() {
        let hash = "0123456789abcdef0123456789abcdef01234567";
        let line = format!(
            "GET hash={hash} https://user:credential@tracker.invalid/{hash} magnet:?xt=urn:btih:{hash} /home/user/Secret Film.mkv token=private"
        );
        let output = String::from_utf8(redact_engine_line(line.as_bytes())).unwrap();
        assert!(output.contains("01234567[redacted]"));
        for forbidden in [
            hash,
            "https://",
            "tracker.invalid",
            "magnet:",
            "/home/user",
            "Film.mkv",
            "credential",
            "token=private",
        ] {
            assert!(!output.contains(forbidden), "leaked {forbidden}");
        }
    }
}
