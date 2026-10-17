//! Opt-in, bounded playback evidence. Raw mpv strings never leave this module.
use serde_json::Value;
use std::{
    collections::VecDeque,
    fs,
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_LINES: usize = 180;
const MAX_FILE_BYTES: usize = 64 * 1024;

pub(crate) const PROPERTIES: &[&str] = &[
    "hwdec-current",
    "vo-drop-frame-count",
    "decoder-frame-drop-count",
    "mistimed-frame-count",
    "demuxer-cache-duration",
    "cache-buffering-state",
    "paused-for-cache",
    "time-pos",
    "display-fps",
    "estimated-vf-fps",
];

// Keep only a controlled vocabulary. mpv can put titles, local paths, tokens,
// URLs and infohashes in otherwise ordinary warning messages.
fn classified_log(value: &Value) -> Option<String> {
    let prefix = value.get("prefix")?.as_str()?;
    let prefix = match prefix {
        "vd" | "vo" | "demuxer" | "ao" | "lavf" | "ffmpeg" | "cplayer" => prefix,
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
        "mpv prefix={prefix} level={level} category={category}"
    ))
}

fn safe_value(name: &str, value: &Value) -> String {
    if name == "hwdec-current" {
        return match value.as_str() {
            Some(
                "no" | "vaapi" | "vaapi-copy" | "vdpau" | "vdpau-copy" | "nvdec" | "nvdec-copy"
                | "d3d11va" | "d3d11va-copy" | "videotoolbox" | "videotoolbox-copy",
            ) => value.as_str().unwrap().to_owned(),
            _ => "unknown".into(),
        };
    }
    if name == "paused-for-cache" {
        return value
            .as_bool()
            .map(|v| v.to_string())
            .unwrap_or_else(|| "unknown".into());
    }
    value
        .as_f64()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .map(|v| format!("{v:.3}"))
        .unwrap_or_else(|| "unknown".into())
}

pub(crate) struct PlaybackDiagnostics {
    root: PathBuf,
    file: Option<PathBuf>,
    lines: VecDeque<String>,
    hwdec: String,
    vo_drops: u64,
    decoder_drops: u64,
    mistimed: u64,
    cache_underruns: u64,
    was_cache_paused: bool,
}

impl PlaybackDiagnostics {
    pub(crate) fn is_active(&self) -> bool {
        self.file.is_some()
    }
    pub(crate) fn new(cache_dir: &Path) -> Self {
        Self {
            root: cache_dir.join("diagnostics"),
            file: None,
            lines: VecDeque::new(),
            hwdec: "unknown".into(),
            vo_drops: 0,
            decoder_drops: 0,
            mistimed: 0,
            cache_underruns: 0,
            was_cache_paused: false,
        }
    }

    fn push(&mut self, line: String) {
        if self.lines.len() == MAX_LINES {
            self.lines.pop_front();
        }
        self.lines.push_back(line);
    }

    pub(crate) fn start(&mut self, sequence: u64) {
        self.finish();
        self.lines.clear();
        self.hwdec = "unknown".into();
        self.vo_drops = 0;
        self.decoder_drops = 0;
        self.mistimed = 0;
        self.cache_underruns = 0;
        self.was_cache_paused = false;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        self.file = Some(self.root.join(format!("playback-{stamp}-{sequence}.log")));
        self.rotate();
        self.summary();
        self.flush();
    }

    pub(crate) fn log(&mut self, value: &Value) {
        if self.file.is_some()
            && let Some(line) = classified_log(value)
        {
            self.push(line);
        }
    }

    pub(crate) fn sample(&mut self, name: &str, value: &Value) {
        if self.file.is_none() || !PROPERTIES.contains(&name) {
            return;
        }
        let safe = safe_value(name, value);
        match name {
            "hwdec-current" => self.hwdec = safe.clone(),
            "vo-drop-frame-count" => self.vo_drops = value.as_u64().unwrap_or(0),
            "decoder-frame-drop-count" => self.decoder_drops = value.as_u64().unwrap_or(0),
            "mistimed-frame-count" => self.mistimed = value.as_u64().unwrap_or(0),
            "paused-for-cache" => {
                let paused = value.as_bool() == Some(true);
                if paused && !self.was_cache_paused {
                    self.cache_underruns += 1;
                }
                self.was_cache_paused = paused;
            }
            _ => {}
        }
        self.push(format!("sample {name}={safe}"));
    }

    fn summary(&mut self) {
        let line = format!(
            "playback hwdec={} vo-drops={} decoder-drops={} mistimed={} cache-underruns={}",
            self.hwdec, self.vo_drops, self.decoder_drops, self.mistimed, self.cache_underruns
        );
        self.push(line.clone());
        eprintln!("[locadora-video] {line}");
    }

    pub(crate) fn flush(&self) {
        let Some(file) = &self.file else {
            return;
        };
        if fs::create_dir_all(&self.root).is_err() {
            return;
        }
        let _ = fs::set_permissions(&self.root, fs::Permissions::from_mode(0o700));
        let mut output = self.lines.iter().cloned().collect::<Vec<_>>().join("\n");
        output.push('\n');
        if output.len() <= MAX_FILE_BYTES
            && let Ok(mut target) = fs::OpenOptions::new()
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
        if self.file.is_some() {
            self.summary();
            self.flush();
            self.file = None;
        }
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
        let excess = files.len().saturating_sub(19);
        for file in files.into_iter().take(excess) {
            let _ = fs::remove_file(file);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn log_and_property_secrets_never_reach_file() {
        let root = std::env::temp_dir().join(format!("wlp-diag-test-{}", std::process::id()));
        let mut diag = PlaybackDiagnostics::new(&root);
        diag.start(1);
        let secret = "0123456789abcdef0123456789abcdef01234567";
        diag.log(&json!({"prefix":"vd", "level":"warn", "text":format!("decode https://user:token@private.example/{secret} /home/user/Secret Film.mkv") }));
        diag.sample(
            "hwdec-current",
            &json!(format!(
                "vaapi-copy https://secret.example/{secret} /tmp/key"
            )),
        );
        diag.sample(
            "time-pos",
            &json!(format!("https://secret.example/{secret} /tmp/key")),
        );
        diag.finish();
        let file = fs::read_dir(root.join("diagnostics"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        let output = fs::read_to_string(file).unwrap();
        for token in [
            "token",
            "private.example",
            "secret.example",
            secret,
            "/home/user",
            "/tmp/key",
            "Secret Film",
        ] {
            assert!(!output.contains(token), "leaked {token}");
        }
        assert!(output.contains("category=decode"));
        fs::remove_dir_all(root).unwrap();
    }
}
