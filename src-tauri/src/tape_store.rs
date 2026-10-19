use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const MANIFEST_NAME: &str = "tape-store.json";
const MAX_MANIFEST_BYTES: usize = 16 * 1024 * 1024;
const MAX_TAPES: usize = 10;
const MAX_TORRENT_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TapeManifest {
    version: u8,
    tapes: Vec<TapeManifestEntry>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TapeManifestEntry {
    rental_id: String,
    content_id: String,
    title: String,
    info_hash: String,
    file_idx: u16,
    file_name: String,
    size_bytes: u64,
    descriptor: TapeDescriptor,
    torrent_bytes_b64: Option<String>,
    state: TapeState,
    added_at: String,
    completed_at: Option<String>,
    last_played_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TapeDescriptor {
    sources: Vec<String>,
    magnet: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum TapeState {
    Queued,
    Resolving,
    Downloading,
    Ready,
    Seeding,
    Failed,
    Returned,
    Unverified,
}

fn bounded_text(value: &str, max_bytes: usize) -> bool {
    !value.is_empty() && value.len() <= max_bytes && !value.chars().any(char::is_control)
}

fn optional_timestamp_valid(value: Option<&str>) -> bool {
    value.is_none_or(|value| bounded_text(value, 64))
}

fn validate_manifest(manifest: &TapeManifest) -> bool {
    if manifest.version != 1 || manifest.tapes.len() > MAX_TAPES {
        return false;
    }
    manifest.tapes.iter().all(|tape| {
        bounded_text(&tape.rental_id, 180)
            && bounded_text(&tape.content_id, 180)
            && bounded_text(&tape.title, 512)
            && tape.info_hash.len() == 40
            && tape
                .info_hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            && tape.file_idx <= 9_999
            && bounded_text(&tape.file_name, 1_024)
            && (1..=9_007_199_254_740_991).contains(&tape.size_bytes)
            && tape.descriptor.sources.len() <= 64
            && tape
                .descriptor
                .sources
                .iter()
                .all(|source| bounded_text(source, 2_048))
            && bounded_text(&tape.descriptor.magnet, 8_192)
            && tape.descriptor.magnet.starts_with("magnet:?")
            && tape.torrent_bytes_b64.as_deref().is_none_or(|encoded| {
                encoded.len() <= MAX_TORRENT_BYTES.div_ceil(3) * 4
                    && STANDARD
                        .decode(encoded)
                        .is_ok_and(|bytes| !bytes.is_empty() && bytes.len() <= MAX_TORRENT_BYTES)
            })
            && bounded_text(&tape.added_at, 64)
            && optional_timestamp_valid(tape.completed_at.as_deref())
            && optional_timestamp_valid(tape.last_played_at.as_deref())
    })
}

fn manifest_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(MANIFEST_NAME)
}

fn read_manifest(path: &Path) -> Result<Option<TapeManifest>, String> {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err("Could not read the tape manifest".into()),
    };
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Ok(None);
    }
    let Ok(manifest) = serde_json::from_slice::<TapeManifest>(&bytes) else {
        return Ok(None);
    };
    Ok(validate_manifest(&manifest).then_some(manifest))
}

fn write_manifest(app_data_dir: &Path, manifest: &TapeManifest) -> Result<(), String> {
    if !validate_manifest(manifest) {
        return Err("Invalid tape manifest".into());
    }
    let bytes = serde_json::to_vec(manifest).map_err(|_| "Could not encode the tape manifest")?;
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err("Tape manifest exceeded the storage limit".into());
    }
    fs::create_dir_all(app_data_dir).map_err(|_| "Could not create private app storage")?;
    fs::set_permissions(app_data_dir, fs::Permissions::from_mode(0o700))
        .map_err(|_| "Could not protect private app storage")?;

    let destination = manifest_path(app_data_dir);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let temporary = app_data_dir.join(format!(
        ".{MANIFEST_NAME}.{}-{nonce}.tmp",
        std::process::id()
    ));
    let result = (|| {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&temporary)
            .map_err(|_| "Could not create the tape manifest")?;
        file.write_all(&bytes)
            .map_err(|_| "Could not write the tape manifest")?;
        file.sync_all()
            .map_err(|_| "Could not save the tape manifest")?;
        drop(file);
        fs::rename(&temporary, &destination).map_err(|_| "Could not replace the tape manifest")?;
        fs::File::open(app_data_dir)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "Could not finalize the tape manifest".to_owned())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

fn clear_manifest(app_data_dir: &Path) -> Result<(), String> {
    match fs::remove_file(manifest_path(app_data_dir)) {
        Ok(()) => fs::File::open(app_data_dir)
            .and_then(|directory| directory.sync_all())
            .map_err(|_| "Could not finalize tape manifest removal".to_owned()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err("Could not clear the tape manifest".into()),
    }
}

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|_| "Could not locate private app storage".into())
}

#[tauri::command]
pub fn tape_store_read(app: AppHandle) -> Result<Option<TapeManifest>, String> {
    read_manifest(&manifest_path(&app_data_dir(&app)?))
}

#[tauri::command]
pub fn tape_store_write(app: AppHandle, manifest: TapeManifest) -> Result<(), String> {
    write_manifest(&app_data_dir(&app)?, &manifest)
}

#[tauri::command]
pub fn tape_store_clear(app: AppHandle) -> Result<(), String> {
    clear_manifest(&app_data_dir(&app)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn test_root(label: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "locadora-tape-store-{label}-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ))
    }

    fn manifest() -> TapeManifest {
        TapeManifest {
            version: 1,
            tapes: vec![TapeManifestEntry {
                rental_id: "rental-1".into(),
                content_id: "movie:1".into(),
                title: "Synthetic fixture".into(),
                info_hash: "a".repeat(40),
                file_idx: 3,
                file_name: "fixture.mkv".into(),
                size_bytes: 1_610_612_736,
                descriptor: TapeDescriptor {
                    sources: vec!["dht:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".into()],
                    magnet: format!("magnet:?xt=urn:btih:{}", "a".repeat(40)),
                },
                torrent_bytes_b64: None,
                state: TapeState::Ready,
                added_at: "2026-10-19T12:00:00Z".into(),
                completed_at: Some("2026-10-19T13:00:00Z".into()),
                last_played_at: None,
            }],
        }
    }

    #[test]
    fn corrupt_manifest_reads_as_null() {
        let root = test_root("corrupt");
        fs::create_dir_all(&root).unwrap();
        fs::write(manifest_path(&root), b"{not-json").unwrap();
        assert_eq!(read_manifest(&manifest_path(&root)).unwrap(), None);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn valid_manifest_round_trips_through_atomic_private_file() {
        let root = test_root("round-trip");
        let expected = manifest();
        write_manifest(&root, &expected).unwrap();
        assert_eq!(
            read_manifest(&manifest_path(&root)).unwrap(),
            Some(expected)
        );
        assert_eq!(
            fs::metadata(manifest_path(&root))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        assert!(fs::read_dir(&root).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".tmp")
        }));
        clear_manifest(&root).unwrap();
        assert!(!manifest_path(&root).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn manifest_shape_and_size_are_bounded() {
        let root = test_root("bounded");
        let mut invalid = manifest();
        invalid.tapes[0].info_hash = "A".repeat(40);
        assert_eq!(
            write_manifest(&root, &invalid).unwrap_err(),
            "Invalid tape manifest"
        );
        fs::create_dir_all(&root).unwrap();
        fs::write(manifest_path(&root), vec![b' '; MAX_MANIFEST_BYTES + 1]).unwrap();
        assert_eq!(read_manifest(&manifest_path(&root)).unwrap(), None);
        fs::remove_dir_all(root).unwrap();
    }
}
