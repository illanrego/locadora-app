mod network;
#[cfg(unix)]
mod player;
mod stremio;

pub use network::{
    BoundedJsonResponse, JsonRequestMethod, MAX_JSON_BYTES, NativeNetworkError,
    fetch_bounded_https_json, fetch_bounded_https_json_request, validate_manifest_url,
};
#[cfg(unix)]
pub use player::{MpvSession, PlayerError, PlayerEvent, VideoOutput};
pub use stremio::{StremioCoreError, stremio_manifest, stremio_resource};
pub use stremio_core::types::addon::{Manifest, ManifestResource, ResourcePath, ResourceResponse};

use serde::Serialize;
use std::process::Command;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCapability {
    pub available: bool,
    pub version: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCapabilities {
    pub mpv: ToolCapability,
}

fn first_version_line(stdout: &[u8]) -> Option<String> {
    String::from_utf8_lossy(stdout)
        .lines()
        .find(|line| !line.trim().is_empty())
        .map(str::trim)
        .filter(|line| line.len() <= 120)
        .map(ToOwned::to_owned)
}

pub fn probe_mpv() -> ToolCapability {
    let output = Command::new("mpv")
        .args(["--no-config", "--version"])
        .output();
    match output {
        Ok(output) if output.status.success() => ToolCapability {
            available: true,
            version: first_version_line(&output.stdout),
        },
        _ => ToolCapability {
            available: false,
            version: None,
        },
    }
}

pub fn native_capabilities() -> NativeCapabilities {
    NativeCapabilities { mpv: probe_mpv() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_only_a_short_first_version_line() {
        assert_eq!(
            first_version_line(b"mpv 1.2.3\nother details\n"),
            Some("mpv 1.2.3".into())
        );
        assert_eq!(first_version_line(&[b'x'; 121]), None);
    }

    #[test]
    fn capability_probe_never_accepts_a_media_argument() {
        // The public probe has no parameter by design. This exercises either outcome.
        let capability = probe_mpv();
        if capability.available {
            assert!(
                capability
                    .version
                    .as_deref()
                    .unwrap_or_default()
                    .starts_with("mpv")
            );
        } else {
            assert!(capability.version.is_none());
        }
    }
}
