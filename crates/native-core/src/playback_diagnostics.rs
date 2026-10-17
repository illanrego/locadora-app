//! Opt-in, bounded playback evidence. Raw mpv strings never leave this module.
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet, VecDeque},
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
pub(crate) const PROPERTIES: &[&str] = &[
    "hwdec-current",
    "video-params/pixelformat",
    "vo-drop-frame-count",
    "decoder-frame-drop-count",
    "vo-delayed-frame-count",
    "demuxer-cache-duration",
    "cache-buffering-state",
    "paused-for-cache",
    "time-pos",
    "estimated-vf-fps",
];
pub(crate) const SOURCE_PROPERTIES: &[&str] = &[
    "width",
    "height",
    "video-format",
    "video-codec",
    "video-bitrate",
    "audio-codec",
    "audio-bitrate",
];

fn token(value: &str) -> Option<&str> {
    (value.len() <= 32
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-'))
    .then_some(value)
}

fn classified_log(value: &Value) -> Option<String> {
    let prefix = match value.get("prefix")?.as_str()? {
        "vd" | "vo" | "demuxer" | "ao" | "lavf" | "ffmpeg" | "cplayer" => {
            value.get("prefix")?.as_str()?
        }
        _ => return None,
    };
    let level = match value.get("level")?.as_str()? {
        "warn" | "error" | "fatal" => value.get("level")?.as_str()?,
        _ => return None,
    };
    let lower = value.get("text")?.as_str()?.to_ascii_lowercase();
    let category = if lower.contains("hardware decoding")
        || lower.contains("hwdec")
        || lower.contains("vaapi")
    {
        "hardware-decode"
    } else if lower.contains("decoder") || lower.contains("decode") {
        "decode"
    } else if lower.contains("cache") || lower.contains("buffer") {
        "buffering"
    } else if lower.contains("frame") || lower.contains("timing") || lower.contains("vsync") {
        "frame-timing"
    } else if lower.contains("audio") {
        "audio"
    } else {
        "other"
    };
    Some(format!(
        "log prefix={prefix} level={level} category={category}"
    ))
}

fn safe_value(name: &str, reply: &Value) -> String {
    if reply
        .get("error")
        .and_then(Value::as_str)
        .is_some_and(|error| error != "success")
    {
        return "unavailable".into();
    }
    let value = reply.get("data").unwrap_or(reply);
    if value.is_null() {
        return "unavailable".into();
    }
    match name {
        "hwdec-current" => match value.as_str() {
            Some("") | Some("no") => "no".into(),
            Some(value) => token(value).unwrap_or("unknown").into(),
            None => "unknown".into(),
        },
        "video-params/pixelformat" | "video-format" => {
            value.as_str().and_then(token).unwrap_or("unknown").into()
        }
        "video-codec" | "audio-codec" => {
            // mpv appends a descriptive parenthesis to codec names. Only its
            // leading codec identifier is retained, under a closed vocabulary.
            const CODECS: &[&str] = &[
                "h264",
                "hevc",
                "av1",
                "vp9",
                "vp8",
                "mpeg2video",
                "mpeg4",
                "aac",
                "ac3",
                "eac3",
                "dts",
                "flac",
                "opus",
                "vorbis",
                "mp3",
                "pcm_s16le",
                "truehd",
            ];
            value
                .as_str()
                .and_then(|raw| raw.split(' ').next())
                .filter(|code| CODECS.contains(code))
                .unwrap_or("unknown")
                .into()
        }
        "paused-for-cache" => value
            .as_bool()
            .map(|v| if v { "1" } else { "0" })
            .unwrap_or("unknown")
            .into(),
        _ => value
            .as_f64()
            .filter(|v| v.is_finite() && *v >= 0.0 && *v <= 1e12)
            .map(|v| {
                if matches!(
                    name,
                    "width"
                        | "height"
                        | "vo-drop-frame-count"
                        | "decoder-frame-drop-count"
                        | "vo-delayed-frame-count"
                        | "cache-buffering-state"
                ) {
                    format!("{v:.0}")
                } else {
                    format!("{v:.3}")
                }
            })
            .unwrap_or_else(|| "unknown".into()),
    }
}

fn stamp() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(crate) struct PlaybackDiagnostics {
    root: PathBuf,
    file: Option<PathBuf>,
    timeline: VecDeque<(String, bool)>,
    source: Option<String>,
    summary_start: String,
    summary_end: Option<String>,
    values: HashMap<&'static str, String>,
    source_seen: HashSet<&'static str>,
    first_playback_seen: bool,
    pause_started: Option<Instant>,
    pause_is_initial: bool,
    cache_underruns: u64,
    cache_pause_seconds: f64,
    initial_buffer_seconds: f64,
}

impl PlaybackDiagnostics {
    pub(crate) fn new(cache_dir: &Path) -> Self {
        Self {
            root: cache_dir.join("diagnostics"),
            file: None,
            timeline: VecDeque::new(),
            source: None,
            summary_start: String::new(),
            summary_end: None,
            values: HashMap::new(),
            source_seen: HashSet::new(),
            first_playback_seen: false,
            pause_started: None,
            pause_is_initial: false,
            cache_underruns: 0,
            cache_pause_seconds: 0.0,
            initial_buffer_seconds: 0.0,
        }
    }
    pub(crate) fn is_active(&self) -> bool {
        self.file.is_some()
    }

    fn push(&mut self, line: String) {
        self.timeline.push_back((line, false));
        self.trim();
    }

    fn trim(&mut self) {
        while self.output_bytes() > MAX_FILE_BYTES {
            let Some(index) = self.timeline.iter().position(|(_, pinned)| !pinned) else {
                break;
            };
            self.timeline.remove(index);
        }
    }

    fn output_bytes(&self) -> usize {
        self.summary_start.len()
            + self.summary_end.as_ref().map_or(0, String::len)
            + self.source.as_ref().map_or(0, String::len)
            + self
                .timeline
                .iter()
                .map(|(line, _)| line.len())
                .sum::<usize>()
            + self.timeline.len()
            + 3
    }

    pub(crate) fn start(&mut self, sequence: u64) {
        self.finish();
        self.timeline.clear();
        self.source = None;
        self.values.clear();
        self.source_seen.clear();
        self.summary_end = None;
        self.first_playback_seen = false;
        self.pause_started = None;
        self.pause_is_initial = false;
        self.cache_underruns = 0;
        self.cache_pause_seconds = 0.0;
        self.initial_buffer_seconds = 0.0;
        self.file = Some(
            self.root
                .join(format!("playback-{}-{sequence}.log", stamp())),
        );
        self.summary_start = "playback start".into();
        eprintln!("[locadora-video] {}", self.summary_start);
        self.rotate();
        self.flush();
    }

    pub(crate) fn log(&mut self, value: &Value) {
        if self.is_active()
            && let Some(line) = classified_log(value)
        {
            self.push(line);
            self.flush();
        }
    }

    pub(crate) fn sample(&mut self, name: &'static str, reply: &Value) {
        if !self.is_active() || (!PROPERTIES.contains(&name) && !SOURCE_PROPERTIES.contains(&name))
        {
            return;
        }
        let safe = safe_value(name, reply);
        self.values.insert(name, safe);
        if SOURCE_PROPERTIES.contains(&name) {
            self.source_seen.insert(name);
            if self.source_seen.len() == SOURCE_PROPERTIES.len() {
                let line = format!(
                    "source width={} height={} video-format={} video-codec={} video-bitrate={} audio-codec={} audio-bitrate={}",
                    self.get("width"),
                    self.get("height"),
                    self.get("video-format"),
                    self.get("video-codec"),
                    self.get("video-bitrate"),
                    self.get("audio-codec"),
                    self.get("audio-bitrate")
                );
                if self.source.as_ref() != Some(&line) {
                    self.source = Some(line);
                    self.flush();
                }
            }
        }
    }

    fn get(&self, name: &str) -> &str {
        self.values
            .get(name)
            .map(String::as_str)
            .unwrap_or("unavailable")
    }

    pub(crate) fn cache_pause(&mut self, value: &Value) {
        if !self.is_active() {
            return;
        }
        match value.as_bool() {
            Some(true) if self.pause_started.is_none() => {
                self.pause_started = Some(Instant::now());
                self.pause_is_initial = !self.first_playback_seen;
                if !self.pause_is_initial {
                    self.cache_underruns += 1;
                }
            }
            Some(false) => {
                if let Some(start) = self.pause_started.take() {
                    let elapsed = start.elapsed().as_secs_f64();
                    if self.pause_is_initial {
                        self.initial_buffer_seconds += elapsed;
                        self.push(format!("initial-buffer pause={elapsed:.3}"));
                    } else {
                        self.cache_pause_seconds += elapsed;
                        self.push(format!("cache-pause pause={elapsed:.3}"));
                    }
                    self.flush();
                }
                self.first_playback_seen = true;
            }
            _ => {}
        }
    }

    pub(crate) fn tick(&mut self) {
        if !self.is_active() {
            return;
        }
        self.push(format!(
            "t={} hw={} pix={} vo={} dec={} delayed={} cache={} buf={} pfc={} fps={}",
            self.get("time-pos"),
            self.get("hwdec-current"),
            self.get("video-params/pixelformat"),
            self.get("vo-drop-frame-count"),
            self.get("decoder-frame-drop-count"),
            self.get("vo-delayed-frame-count"),
            self.get("demuxer-cache-duration"),
            self.get("cache-buffering-state"),
            self.get("paused-for-cache"),
            self.get("estimated-vf-fps")
        ));
        self.flush();
    }

    pub(crate) fn mark(&mut self, position: Option<f64>) {
        let line = mark_line(
            position,
            self.get("vo-drop-frame-count"),
            self.get("decoder-frame-drop-count"),
            self.get("vo-delayed-frame-count"),
        );
        eprintln!("[locadora-video] {line}");
        if self.is_active() {
            self.timeline.push_back((line, true));
            self.trim();
            self.flush();
        }
    }

    pub(crate) fn flush(&self) {
        let Some(file) = &self.file else {
            return;
        };
        if fs::create_dir_all(&self.root).is_err() {
            return;
        }
        let _ = fs::set_permissions(&self.root, fs::Permissions::from_mode(0o700));
        let mut output = format!("{}\n", self.summary_start);
        if let Some(source) = &self.source {
            output.push_str(source);
            output.push('\n');
        }
        for (line, _) in &self.timeline {
            output.push_str(line);
            output.push('\n');
        }
        if let Some(end) = &self.summary_end {
            output.push_str(end);
            output.push('\n');
        }
        if let Ok(mut target) = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(file)
        {
            let _ = target.write_all(output.as_bytes());
        }
    }

    pub(crate) fn finish(&mut self) {
        if !self.is_active() {
            return;
        }
        if let Some(start) = self.pause_started.take() {
            let elapsed = start.elapsed().as_secs_f64();
            if self.pause_is_initial {
                self.initial_buffer_seconds += elapsed;
            } else {
                self.cache_pause_seconds += elapsed;
            }
        }
        let line = format!(
            "playback end hw={} vo={} dec={} delayed={} cache-underruns={} cache-pause={:.3} initial-buffer={:.3}",
            self.get("hwdec-current"),
            self.get("vo-drop-frame-count"),
            self.get("decoder-frame-drop-count"),
            self.get("vo-delayed-frame-count"),
            self.cache_underruns,
            self.cache_pause_seconds,
            self.initial_buffer_seconds
        );
        eprintln!("[locadora-video] {line}");
        self.summary_end = Some(line);
        self.flush();
        self.file = None;
    }

    fn rotate(&self) {
        let Ok(entries) = fs::read_dir(&self.root) else {
            return;
        };
        let mut files = entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.starts_with("playback-") && name.ends_with(".log"))
            })
            .collect::<Vec<_>>();
        files.sort();
        let excess = files.len().saturating_sub(20);
        for file in files.into_iter().take(excess) {
            let _ = fs::remove_file(file);
        }
    }
}

pub(crate) fn mark_without_diagnostics(position: Option<f64>) {
    eprintln!(
        "[locadora-video] {}",
        mark_line(position, "unavailable", "unavailable", "unavailable")
    );
}

fn mark_line(position: Option<f64>, vo: &str, dec: &str, delayed: &str) -> String {
    let position = position
        .filter(|value| value.is_finite() && *value >= 0.0 && *value <= 1e12)
        .map(|value| format!("{value:.3}"))
        .unwrap_or_else(|| "unavailable".into());
    format!(
        "mark wall={} t={position} vo={vo} dec={dec} delayed={delayed}",
        stamp()
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicU64, Ordering};
    static TEST_ID: AtomicU64 = AtomicU64::new(1);
    fn temp_root() -> PathBuf {
        let root = std::env::temp_dir().join(format!(
            "wlp-diag-test-{}-{}",
            std::process::id(),
            TEST_ID.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).unwrap();
        root
    }
    #[test]
    fn decode_method_and_unavailable_are_distinct() {
        assert_eq!(
            safe_value("hwdec-current", &json!({"error":"success","data":""})),
            "no"
        );
        assert_eq!(
            safe_value("hwdec-current", &json!({"data":"vaapi-egl"})),
            "vaapi-egl"
        );
        assert_eq!(
            safe_value("hwdec-current", &json!({"data":"vaapi-x11"})),
            "vaapi-x11"
        );
        assert_eq!(
            safe_value("hwdec-current", &json!({"error":"property unavailable"})),
            "unavailable"
        );
        assert_eq!(
            safe_value("hwdec-current", &json!({"data":null})),
            "unavailable"
        );
    }
    #[test]
    fn timeline_keeps_marks_source_and_summaries() {
        let root = temp_root();
        let mut diag = PlaybackDiagnostics::new(&root);
        diag.start(1);
        for &name in SOURCE_PROPERTIES {
            diag.sample(
                name,
                &json!({"data": if name == "video-format" { json!("h264") } else { json!(128) }}),
            );
        }
        diag.cache_pause(&json!(true));
        diag.cache_pause(&json!(false));
        assert_eq!(diag.cache_underruns, 0);
        diag.cache_pause(&json!(true));
        diag.cache_pause(&json!(false));
        assert_eq!(diag.cache_underruns, 1);
        assert!(
            diag.timeline
                .iter()
                .any(|(line, _)| line.starts_with("initial-buffer pause="))
        );
        for _ in 0..2200 {
            diag.push(format!("t=1 {}", "x".repeat(1024)));
        }
        diag.mark(Some(12.5));
        diag.finish();
        let file = fs::read_dir(root.join("diagnostics"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let output = fs::read_to_string(file).unwrap();
        assert!(output.len() <= MAX_FILE_BYTES);
        assert!(output.contains("source width="));
        assert!(output.contains("mark wall="));
        assert!(output.contains("playback start"));
        assert!(output.contains("playback end"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn log_and_property_secrets_never_reach_file() {
        let root = temp_root();
        let mut diag = PlaybackDiagnostics::new(&root);
        diag.start(1);
        let secret = "0123456789abcdef0123456789abcdef01234567";
        for raw in [
            format!("https://user:token@private.example/{secret}"),
            "/home/user/Secret Film.mkv".into(),
            secret.into(),
            "a".repeat(33),
            "vaapi copy !".into(),
        ] {
            diag.log(&json!({"prefix":"vd", "level":"warn", "text":format!("decode {raw}")}));
            for &name in PROPERTIES.iter().chain(SOURCE_PROPERTIES.iter()) {
                diag.sample(name, &json!({"error":"success","data":raw}));
            }
            diag.tick();
        }
        diag.mark(Some(1.0));
        diag.finish();
        let file = fs::read_dir(root.join("diagnostics"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let output = fs::read_to_string(file).unwrap();
        for forbidden in [
            "token",
            "private.example",
            secret,
            "/home/user",
            "Secret Film",
            &"a".repeat(33),
            "vaapi copy !",
        ] {
            assert!(!output.contains(forbidden), "leaked {forbidden}");
        }
        assert!(output.contains("category=decode"));
        fs::remove_dir_all(root).unwrap();
    }
}
