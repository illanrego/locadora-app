use locadora_native_core::{
    JsonRequestMethod, Manifest, ManifestResource, MpvSession, NativeCapabilities, PlayerEvent,
    ResourcePath, VideoOutput, fetch_bounded_https_json, fetch_bounded_https_json_request,
    native_capabilities as read_native_capabilities, stremio_manifest, stremio_resource,
    validate_manifest_url,
};
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};
use urlencoding::encode;

const PUBLIC_API_BASE: &str = "https://locadora-api.willstartpage.workers.dev/v1";
const MEMBER_API_BASE: &str = "https://locadora-data.willstartpage.workers.dev";
const MEMBER_SIGNUP_CALLBACK: &str = "https://willslocadora.sitedoillan.com.br/?verified=1";
const ALLOWED_GENRES: &[&str] = &[
    "Action",
    "Adventure",
    "Animation",
    "Comedy",
    "Crime",
    "Documentary",
    "Drama",
    "Family",
    "Fantasy",
    "Horror",
    "Mystery",
    "Romance",
    "Sci-Fi",
    "Thriller",
];
const KEYRING_SERVICE: &str = "com.illanrego.willslocadora.media";
const KEYRING_ACCOUNT: &str = "addon-manifests-v1";
const MEMBER_KEYRING_SERVICE: &str = "com.illanrego.willslocadora.member";
const MEMBER_KEYRING_ACCOUNT: &str = "better-auth-session-v1";
const MEDIA_CONFIGURATION_VERSION: u8 = 3;
const MAX_CONFIGURED_ADDONS: usize = 64;
const MAX_MANIFEST_RESOURCES: usize = 64;
const MAX_RESOURCE_FILTERS: usize = 64;
const MAX_STREMIO_LOCAL_STORAGE_BYTES: usize = 2 * 1024 * 1024;
const STREMIO_ADDONS_KEY_V4: &[u8] = b"_https://app.strem.io\0\x01addons";
const STREMIO_ADDONS_KEY_V5: &[u8] = b"_https://web.stremio.com\0\x01addons";

#[derive(Default)]
pub struct PlayerState(Mutex<Option<MpvSession>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredResourceRequest {
    addon_id: String,
    resource: String,
    content_type: String,
    id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerPropertyRequest {
    name: String,
    value: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicShelfRequest {
    genres: Vec<String>,
    year: u16,
    content_type: String,
    stand: u8,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberCredentials {
    identifier: String,
    password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberSignup {
    email: String,
    username: String,
    password: String,
}

#[derive(Debug, Deserialize)]
pub struct MemberProfileUpdate {
    username: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberCollectionUpdate {
    collection: String,
    enabled: bool,
    tmdb_id: u64,
    content_type: String,
    name: String,
    year: Option<u16>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberRentalTitle {
    tmdb_id: u64,
    content_type: String,
    name: String,
    year: Option<u16>,
}

#[derive(Debug, Deserialize)]
pub struct MemberRentalRequest {
    titles: Vec<MemberRentalTitle>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberReturnRequest {
    item_id: String,
    watched_status: String,
}

#[derive(Debug, Deserialize)]
pub struct MemberHistoryRequest {
    offset: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleReviewRequest {
    tmdb_id: u64,
    content_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MemberReviewWrite {
    tmdb_id: u64,
    content_type: String,
    rating: f64,
    body: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemberUser {
    id: String,
    username: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MemberSessionStatus {
    configured: bool,
    signed_in: bool,
    user: Option<MemberUser>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PlayerAction {
    Pause,
    Resume,
    Seek,
    Stop,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredResource {
    name: String,
    #[serde(default)]
    types: Vec<String>,
    #[serde(default)]
    id_prefixes: Vec<String>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredAddon {
    manifest_url: String,
    id: String,
    name: String,
    #[serde(default)]
    resources: Vec<StoredResource>,
    #[serde(default)]
    manifest: Option<Manifest>,
    #[serde(default, skip_serializing)]
    supports_streams: bool,
    #[serde(default, skip_serializing)]
    supports_subtitles: bool,
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredMediaConfiguration {
    version: u8,
    addons: Vec<StoredAddon>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfiguredAddon {
    id: String,
    name: String,
    resources: Vec<String>,
    supports_streams: bool,
    supports_subtitles: bool,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SkippedStremioAddon {
    name: String,
    reason: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StremioImportResult {
    addons: Vec<ConfiguredAddon>,
    imported: usize,
    skipped: Vec<SkippedStremioAddon>,
    source: String,
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring_entry_for(KEYRING_ACCOUNT)
}

fn keyring_entry_for(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|_| "Protected media storage is unavailable".into())
}

fn member_keyring_entry() -> Result<keyring::Entry, String> {
    keyring::Entry::new(MEMBER_KEYRING_SERVICE, MEMBER_KEYRING_ACCOUNT)
        .map_err(|_| "Protected member storage is unavailable".into())
}

fn load_member_token() -> Result<Option<String>, String> {
    match member_keyring_entry()?.get_password() {
        Ok(token) if !token.is_empty() && token.len() <= 16 * 1024 => Ok(Some(token)),
        Ok(_) => Err("Protected member session is invalid".into()),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err("Protected member storage is unavailable".into()),
    }
}

fn store_member_token(token: &str) -> Result<(), String> {
    if token.is_empty() || token.len() > 16 * 1024 || token.chars().any(char::is_control) {
        return Err("Member service returned an invalid session".into());
    }
    member_keyring_entry()?
        .set_password(token)
        .map_err(|_| "Protected member storage is unavailable".into())
}

fn delete_member_token() -> Result<(), String> {
    match member_keyring_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Protected member storage is unavailable".into()),
    }
}

fn signed_out_member_status() -> MemberSessionStatus {
    MemberSessionStatus {
        configured: true,
        signed_in: false,
        user: None,
    }
}

fn member_user(body: &Value) -> Option<MemberUser> {
    let user = body.get("user")?;
    let id = user.get("id")?.as_str()?.trim();
    if id.is_empty() || id.len() > 160 {
        return None;
    }
    let username = user
        .get("username")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.len() <= 24)
        .map(ToOwned::to_owned);
    Some(MemberUser {
        id: id.to_owned(),
        username,
    })
}

fn validate_member_credentials(credentials: &MemberCredentials) -> Result<(), String> {
    let identifier = credentials.identifier.trim();
    if identifier.len() < 3
        || identifier.len() > 254
        || identifier.chars().any(|character| character.is_control())
    {
        return Err("Enter a valid email or username".into());
    }
    if credentials.password.len() < 6
        || credentials.password.len() > 128
        || credentials.password.chars().any(char::is_control)
    {
        return Err("Password must contain 6 to 128 characters".into());
    }
    Ok(())
}

fn normalized_member_username(value: &str) -> Result<String, String> {
    let username = value.trim().to_ascii_lowercase();
    if !(3..=24).contains(&username.len())
        || !username
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"_-".contains(&byte))
    {
        return Err("Username must be 3 to 24 lowercase letters, numbers, _ or -".into());
    }
    Ok(username)
}

fn validate_member_signup(signup: &MemberSignup) -> Result<String, String> {
    let email = signup.email.trim();
    let Some((local, domain)) = email.split_once('@') else {
        return Err("Enter a valid email address".into());
    };
    if local.is_empty()
        || domain.is_empty()
        || !domain.contains('.')
        || email.len() > 254
        || email.chars().any(char::is_whitespace)
        || email.chars().any(char::is_control)
    {
        return Err("Enter a valid email address".into());
    }
    validate_member_credentials(&MemberCredentials {
        identifier: email.into(),
        password: signup.password.clone(),
    })?;
    normalized_member_username(&signup.username)
}

fn validate_member_collection(update: &MemberCollectionUpdate) -> Result<(), String> {
    if !matches!(update.collection.as_str(), "watch_later" | "favorite")
        || !matches!(update.content_type.as_str(), "movie" | "series")
        || update.tmdb_id == 0
        || update.name.trim().is_empty()
        || update.name.trim().len() > 240
        || update
            .year
            .is_some_and(|year| !(1870..=2100).contains(&year))
    {
        return Err("Invalid saved-title request".into());
    }
    Ok(())
}

fn validate_member_rental(request: &MemberRentalRequest) -> Result<(), String> {
    if request.titles.is_empty() || request.titles.len() > 3 {
        return Err("Choose one to three distinct titles".into());
    }
    let mut identities = HashSet::new();
    for title in &request.titles {
        if !matches!(title.content_type.as_str(), "movie" | "series")
            || title.tmdb_id == 0
            || title.name.trim().is_empty()
            || title.name.trim().len() > 240
            || title
                .year
                .is_some_and(|year| !(1870..=2100).contains(&year))
            || !identities.insert((title.content_type.as_str(), title.tmdb_id))
        {
            return Err("Choose one to three distinct titles".into());
        }
    }
    Ok(())
}

fn is_member_uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 36
        || bytes[8] != b'-'
        || bytes[13] != b'-'
        || bytes[18] != b'-'
        || bytes[23] != b'-'
        || !(b'1'..=b'5').contains(&bytes[14])
        || !matches!(bytes[19].to_ascii_lowercase(), b'8' | b'9' | b'a' | b'b')
    {
        return false;
    }
    bytes
        .iter()
        .enumerate()
        .all(|(index, byte)| matches!(index, 8 | 13 | 18 | 23) || byte.is_ascii_hexdigit())
}

fn validate_member_return(request: &MemberReturnRequest) -> Result<(), String> {
    if !is_member_uuid(&request.item_id)
        || !matches!(
            request.watched_status.as_str(),
            "watched" | "not_watched" | "unknown"
        )
    {
        return Err("Invalid rental return".into());
    }
    Ok(())
}

fn validate_history_offset(offset: u16) -> Result<(), String> {
    if offset > 10_000 {
        return Err("Invalid history offset".into());
    }
    Ok(())
}

fn validate_review_title(content_type: &str, tmdb_id: u64) -> Result<(), String> {
    if tmdb_id == 0 || !matches!(content_type, "movie" | "series") {
        return Err("Invalid review title".into());
    }
    Ok(())
}

fn normalized_review(write: &MemberReviewWrite) -> Result<String, String> {
    validate_review_title(&write.content_type, write.tmdb_id)?;
    let body = write.body.split_whitespace().collect::<Vec<_>>().join(" ");
    if !write.rating.is_finite()
        || !(0.5..=5.0).contains(&write.rating)
        || (write.rating * 2.0).fract() != 0.0
        || body.is_empty()
        || body.len() > 1_000
    {
        return Err("A review needs a half-star rating and text up to 1000 characters".into());
    }
    Ok(body)
}

fn member_service_error(status: u16) -> String {
    match status {
        401 | 403 => "Invalid login or password".into(),
        429 => "Too many attempts. Wait a moment and try again".into(),
        500..=599 => "The Locadora member service is temporarily unavailable".into(),
        _ => "The Locadora member action could not be completed".into(),
    }
}

fn member_session_from_body(body: &Value) -> Option<MemberSessionStatus> {
    member_user(body).map(|user| MemberSessionStatus {
        configured: true,
        signed_in: true,
        user: Some(user),
    })
}

async fn member_get_session(token: &str) -> Result<MemberSessionStatus, String> {
    let response = fetch_bounded_https_json_request(
        &format!("{MEMBER_API_BASE}/api/auth/get-session"),
        JsonRequestMethod::Get,
        None,
        Some(token),
    )
    .await
    .map_err(|error| error.to_string())?;
    if matches!(response.status, 401 | 403) {
        delete_member_token()?;
        return Ok(signed_out_member_status());
    }
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    if let Some(refreshed_token) = response.refreshed_token {
        store_member_token(&refreshed_token)?;
    }
    match member_session_from_body(&response.body) {
        Some(status) => Ok(status),
        None => {
            delete_member_token()?;
            Ok(signed_out_member_status())
        }
    }
}

fn migrate_media_configuration(configuration: &mut StoredMediaConfiguration) {
    if configuration.version == 1 {
        for addon in &mut configuration.addons {
            if addon.resources.is_empty() {
                if addon.supports_streams {
                    addon.resources.push(StoredResource {
                        name: "stream".into(),
                        types: vec![],
                        id_prefixes: vec![],
                    });
                }
                if addon.supports_subtitles {
                    addon.resources.push(StoredResource {
                        name: "subtitles".into(),
                        types: vec![],
                        id_prefixes: vec![],
                    });
                }
            }
        }
        configuration.version = 2;
    }
    if configuration.version == 2 {
        configuration.version = MEDIA_CONFIGURATION_VERSION;
    }
}

fn load_media_configuration() -> Result<StoredMediaConfiguration, String> {
    let entry = keyring_entry()?;
    let secret = match entry.get_password() {
        Ok(secret) => secret,
        Err(keyring::Error::NoEntry) => {
            return Ok(StoredMediaConfiguration {
                version: MEDIA_CONFIGURATION_VERSION,
                addons: vec![],
            });
        }
        Err(_) => return Err("Protected media storage is unavailable".into()),
    };
    let mut configuration: StoredMediaConfiguration =
        serde_json::from_str(&secret).map_err(|_| "Protected media configuration is invalid")?;
    migrate_media_configuration(&mut configuration);
    if configuration.version != MEDIA_CONFIGURATION_VERSION
        || configuration.addons.len() > MAX_CONFIGURED_ADDONS
        || configuration
            .addons
            .iter()
            .any(|addon| addon.resources.len() > MAX_MANIFEST_RESOURCES)
        || configuration
            .addons
            .iter()
            .any(|addon| validate_manifest_url(&addon.manifest_url).is_err())
    {
        return Err("Protected media configuration is invalid".into());
    }
    Ok(configuration)
}

fn store_media_configuration(configuration: &StoredMediaConfiguration) -> Result<(), String> {
    let secret = serde_json::to_string(configuration)
        .map_err(|_| "Protected media storage is unavailable")?;
    keyring_entry()?
        .set_password(&secret)
        .map_err(|_| "Protected media storage is unavailable".into())
}

fn sanitized_configuration(configuration: &StoredMediaConfiguration) -> Vec<ConfiguredAddon> {
    configuration
        .addons
        .iter()
        .map(|addon| ConfiguredAddon {
            id: addon.id.clone(),
            name: addon.name.clone(),
            resources: addon_resource_names(addon),
            supports_streams: addon_supports_resource_name(addon, "stream"),
            supports_subtitles: addon_supports_resource_name(addon, "subtitles"),
        })
        .collect()
}

fn addon_resource_names(addon: &StoredAddon) -> Vec<String> {
    const EXPOSED_RESOURCES: &[&str] = &["stream", "subtitles", "meta", "catalog", "addon_catalog"];
    EXPOSED_RESOURCES
        .iter()
        .filter(|name| addon_supports_resource_name(addon, name))
        .map(|name| (*name).to_owned())
        .collect()
}

fn bounded_strings(values: &[String]) -> Vec<String> {
    values
        .iter()
        .filter(|item| !item.is_empty() && item.len() <= 160)
        .take(MAX_RESOURCE_FILTERS)
        .cloned()
        .collect()
}

fn manifest_resources(manifest: &Manifest) -> Vec<StoredResource> {
    let default_types = bounded_strings(&manifest.types);
    let default_prefixes = bounded_strings(manifest.id_prefixes.as_deref().unwrap_or_default());
    manifest
        .resources
        .iter()
        .filter_map(|resource| {
            let (name, types, id_prefixes) = match resource {
                ManifestResource::Short(name) => {
                    (name, default_types.clone(), default_prefixes.clone())
                }
                ManifestResource::Full {
                    name,
                    types,
                    id_prefixes,
                } => (
                    name,
                    types
                        .as_deref()
                        .map(bounded_strings)
                        .unwrap_or_else(|| default_types.clone()),
                    id_prefixes
                        .as_deref()
                        .map(bounded_strings)
                        .unwrap_or_else(|| default_prefixes.clone()),
                ),
            };
            matches!(
                name.as_str(),
                "stream" | "subtitles" | "meta" | "catalog" | "addon_catalog"
            )
            .then(|| StoredResource {
                name: name.clone(),
                types,
                id_prefixes,
            })
        })
        .take(MAX_MANIFEST_RESOURCES)
        .collect()
}

fn addon_supports_resource_name(addon: &StoredAddon, resource_name: &str) -> bool {
    addon
        .manifest
        .as_ref()
        .map(|manifest| {
            manifest.resources.iter().any(|resource| match resource {
                ManifestResource::Short(name) | ManifestResource::Full { name, .. } => {
                    name == resource_name
                }
            })
        })
        .unwrap_or_else(|| {
            addon
                .resources
                .iter()
                .any(|resource| resource.name == resource_name)
        })
}

fn addon_supports(addon: &StoredAddon, resource_name: &str, content_type: &str, id: &str) -> bool {
    if let Some(manifest) = &addon.manifest {
        return manifest.is_resource_supported(&ResourcePath::without_extra(
            resource_name,
            content_type,
            id,
        ));
    }
    addon.resources.iter().any(|resource| {
        resource.name == resource_name
            && (resource.types.is_empty() || resource.types.iter().any(|item| item == content_type))
            && (resource.id_prefixes.is_empty()
                || resource
                    .id_prefixes
                    .iter()
                    .any(|prefix| id.starts_with(prefix)))
    })
}

fn stored_addon_from_manifest(
    manifest_url: String,
    manifest: Manifest,
) -> Result<StoredAddon, String> {
    let id = manifest.id.trim();
    let name = manifest.name.trim();
    if id.is_empty() || id.len() > 160 || name.is_empty() || name.len() > 160 {
        return Err("Add-on manifest is invalid".into());
    }
    let resources = manifest_resources(&manifest);
    if resources.is_empty() {
        return Err("Add-on does not provide compatible resources".into());
    }
    Ok(StoredAddon {
        manifest_url,
        id: id.into(),
        name: name.into(),
        resources,
        manifest: Some(manifest),
        supports_streams: false,
        supports_subtitles: false,
    })
}

fn decode_chromium_local_storage_string(value: &[u8]) -> Result<String, String> {
    if value.is_empty() || value.len() > MAX_STREMIO_LOCAL_STORAGE_BYTES {
        return Err("Installed Stremio add-on data is invalid".into());
    }
    match value[0] {
        0 => {
            let encoded = &value[1..];
            if !encoded.len().is_multiple_of(2) {
                return Err("Installed Stremio add-on data is invalid".into());
            }
            let units = encoded
                .as_chunks::<2>()
                .0
                .iter()
                .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
                .collect::<Vec<_>>();
            String::from_utf16(&units)
                .map_err(|_| "Installed Stremio add-on data is invalid".into())
        }
        1 => Ok(value[1..].iter().map(|byte| char::from(*byte)).collect()),
        _ => Err("Installed Stremio add-on data uses an unsupported encoding".into()),
    }
}

fn read_stremio_addon_values(leveldb_path: &Path) -> Result<Vec<Value>, String> {
    let records = leveldb_core::read_dir(leveldb_path)
        .map_err(|_| "Installed Stremio storage could not be read")?;
    let record = records
        .iter()
        .filter(|record| record.key == STREMIO_ADDONS_KEY_V4 || record.key == STREMIO_ADDONS_KEY_V5)
        .max_by_key(|record| record.seq)
        .ok_or("Installed Stremio has no local add-on collection")?;
    if record.deleted {
        return Err("Installed Stremio has no local add-on collection".into());
    }
    let decoded = decode_chromium_local_storage_string(&record.value)?;
    let value: Value =
        serde_json::from_str(&decoded).map_err(|_| "Installed Stremio add-on data is invalid")?;
    let addons = value
        .as_array()
        .ok_or("Installed Stremio add-on data is invalid")?;
    if addons.len() > MAX_CONFIGURED_ADDONS {
        return Err("Installed Stremio add-on collection is too large".into());
    }
    Ok(addons.clone())
}

fn installed_stremio_leveldb(app: &AppHandle) -> Result<(PathBuf, String), String> {
    let home = app
        .path()
        .home_dir()
        .map_err(|_| "Home directory is unavailable")?;
    let candidates = [
        (
            home.join(
                ".var/app/com.stremio.Stremio/data/Smart Code ltd/Stremio/QtWebEngine/Default/Local Storage/leveldb",
            ),
            "Stremio Flatpak",
        ),
        (
            home.join(
                ".local/share/Smart Code ltd/Stremio/QtWebEngine/Default/Local Storage/leveldb",
            ),
            "Stremio desktop",
        ),
    ];
    candidates
        .into_iter()
        .find(|(path, _)| path.is_dir())
        .map(|(path, source)| (path, source.to_owned()))
        .ok_or("No supported local Stremio installation was found".into())
}

fn skipped_stremio_addon(value: &Value, reason: &str) -> SkippedStremioAddon {
    let name = value
        .pointer("/manifest/name")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|name| !name.is_empty() && name.len() <= 160)
        .unwrap_or("Unnamed add-on");
    SkippedStremioAddon {
        name: name.to_owned(),
        reason: reason.to_owned(),
    }
}

fn import_stremio_addons(values: &[Value]) -> (Vec<StoredAddon>, Vec<SkippedStremioAddon>) {
    let mut addons = Vec::new();
    let mut skipped = Vec::new();
    let mut ids = HashSet::new();
    for value in values {
        let Some(transport_url) = value.get("transportUrl").and_then(Value::as_str) else {
            skipped.push(skipped_stremio_addon(value, "missing transport"));
            continue;
        };
        let Ok(validated) = validate_manifest_url(transport_url) else {
            skipped.push(skipped_stremio_addon(
                value,
                "unsafe or unsupported transport",
            ));
            continue;
        };
        let Some(manifest_value) = value.get("manifest").cloned() else {
            skipped.push(skipped_stremio_addon(value, "missing manifest"));
            continue;
        };
        let Ok(manifest) = serde_json::from_value::<Manifest>(manifest_value) else {
            skipped.push(skipped_stremio_addon(value, "invalid manifest"));
            continue;
        };
        let Ok(addon) = stored_addon_from_manifest(validated.into(), manifest) else {
            skipped.push(skipped_stremio_addon(value, "unsupported manifest"));
            continue;
        };
        if !ids.insert(addon.id.clone()) {
            skipped.push(skipped_stremio_addon(value, "duplicate add-on"));
            continue;
        }
        addons.push(addon);
    }
    (addons, skipped)
}

#[tauri::command]
pub fn native_capabilities() -> NativeCapabilities {
    read_native_capabilities()
}

#[tauri::command]
pub async fn member_session_status() -> Result<MemberSessionStatus, String> {
    match load_member_token()? {
        Some(token) => member_get_session(&token).await,
        None => Ok(signed_out_member_status()),
    }
}

#[tauri::command]
pub async fn member_sign_in(credentials: MemberCredentials) -> Result<MemberSessionStatus, String> {
    validate_member_credentials(&credentials)?;
    let identifier = credentials.identifier.trim();
    let (path, body) = if identifier.contains('@') {
        (
            "sign-in/email",
            serde_json::json!({ "email": identifier, "password": credentials.password }),
        )
    } else {
        (
            "sign-in/username",
            serde_json::json!({ "username": identifier, "password": credentials.password }),
        )
    };
    let response = fetch_bounded_https_json_request(
        &format!("{MEMBER_API_BASE}/api/auth/{path}"),
        JsonRequestMethod::Post,
        Some(&body),
        None,
    )
    .await
    .map_err(|error| error.to_string())?;
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    let token = response
        .refreshed_token
        .ok_or("Member service did not create a desktop session")?;
    let status = member_session_from_body(&response.body)
        .ok_or("Member service returned an invalid session")?;
    store_member_token(&token)?;
    Ok(status)
}

#[tauri::command]
pub async fn member_sign_up(signup: MemberSignup) -> Result<MemberSessionStatus, String> {
    let username = validate_member_signup(&signup)?;
    let body = serde_json::json!({
        "name": username,
        "email": signup.email.trim(),
        "password": signup.password,
        "username": username,
        "callbackURL": MEMBER_SIGNUP_CALLBACK,
    });
    let response = fetch_bounded_https_json_request(
        &format!("{MEMBER_API_BASE}/api/auth/sign-up/email"),
        JsonRequestMethod::Post,
        Some(&body),
        None,
    )
    .await
    .map_err(|error| error.to_string())?;
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    let token = response
        .refreshed_token
        .ok_or("Member service did not create a desktop session")?;
    let status = member_session_from_body(&response.body)
        .ok_or("Member service returned an invalid session")?;
    store_member_token(&token)?;
    Ok(status)
}

#[tauri::command]
pub async fn member_update_profile(update: MemberProfileUpdate) -> Result<Value, String> {
    let username = normalized_member_username(&update.username)?;
    let token = load_member_token()?.ok_or("Sign in to use your personal Locadora")?;
    let body = serde_json::json!({ "username": username });
    let response = fetch_bounded_https_json_request(
        &format!("{MEMBER_API_BASE}/v1/profile"),
        JsonRequestMethod::Put,
        Some(&body),
        Some(&token),
    )
    .await
    .map_err(|error| error.to_string())?;
    if matches!(response.status, 401 | 403) {
        delete_member_token()?;
        return Err("Member session expired. Sign in again".into());
    }
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    if let Some(refreshed_token) = response.refreshed_token {
        store_member_token(&refreshed_token)?;
    }
    Ok(response.body)
}

#[tauri::command]
pub async fn member_update_collection(update: MemberCollectionUpdate) -> Result<Value, String> {
    validate_member_collection(&update)?;
    let token = load_member_token()?.ok_or("Sign in to sync saved titles")?;
    let (method, url, body) = if update.enabled {
        (
            JsonRequestMethod::Post,
            format!("{MEMBER_API_BASE}/v1/collections/{}", update.collection),
            Some(serde_json::json!({
                "title": {
                    "tmdbId": update.tmdb_id,
                    "type": update.content_type,
                    "name": update.name.trim(),
                    "year": update.year,
                },
                "collection": update.collection,
                "source": "locadora",
            })),
        )
    } else {
        (
            JsonRequestMethod::Delete,
            format!(
                "{MEMBER_API_BASE}/v1/collections/{}/{}/{}",
                update.collection, update.content_type, update.tmdb_id
            ),
            None,
        )
    };
    let response = fetch_bounded_https_json_request(&url, method, body.as_ref(), Some(&token))
        .await
        .map_err(|error| error.to_string())?;
    if matches!(response.status, 401 | 403) {
        delete_member_token()?;
        return Err("Member session expired. Sign in again".into());
    }
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    if let Some(refreshed_token) = response.refreshed_token {
        store_member_token(&refreshed_token)?;
    }
    Ok(response.body)
}

#[tauri::command]
pub async fn member_create_rental(request: MemberRentalRequest) -> Result<Value, String> {
    validate_member_rental(&request)?;
    let token = load_member_token()?.ok_or("Sign in to rent your tapes")?;
    let titles = request
        .titles
        .iter()
        .map(|title| {
            serde_json::json!({
                "tmdbId": title.tmdb_id,
                "type": title.content_type,
                "name": title.name.trim(),
                "year": title.year,
            })
        })
        .collect::<Vec<_>>();
    let body = serde_json::json!({ "titles": titles });
    let response = fetch_bounded_https_json_request(
        &format!("{MEMBER_API_BASE}/v1/rentals"),
        JsonRequestMethod::Post,
        Some(&body),
        Some(&token),
    )
    .await
    .map_err(|error| error.to_string())?;
    if matches!(response.status, 401 | 403) {
        delete_member_token()?;
        return Err("Member session expired. Sign in again".into());
    }
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    if let Some(refreshed_token) = response.refreshed_token {
        store_member_token(&refreshed_token)?;
    }
    Ok(response.body)
}

#[tauri::command]
pub async fn member_return_rental(request: MemberReturnRequest) -> Result<Value, String> {
    validate_member_return(&request)?;
    let token = load_member_token()?.ok_or("Sign in to return your tapes")?;
    let body = serde_json::json!({ "watchedStatus": request.watched_status });
    let response = fetch_bounded_https_json_request(
        &format!(
            "{MEMBER_API_BASE}/v1/rental-items/{}/return",
            request.item_id
        ),
        JsonRequestMethod::Post,
        Some(&body),
        Some(&token),
    )
    .await
    .map_err(|error| error.to_string())?;
    if matches!(response.status, 401 | 403) {
        delete_member_token()?;
        return Err("Member session expired. Sign in again".into());
    }
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    if let Some(refreshed_token) = response.refreshed_token {
        store_member_token(&refreshed_token)?;
    }
    Ok(response.body)
}

#[tauri::command]
pub async fn member_history(request: MemberHistoryRequest) -> Result<Value, String> {
    validate_history_offset(request.offset)?;
    let token = load_member_token()?.ok_or("Sign in to view your history")?;
    let response = fetch_bounded_https_json_request(
        &format!("{MEMBER_API_BASE}/v1/history?offset={}", request.offset),
        JsonRequestMethod::Get,
        None,
        Some(&token),
    )
    .await
    .map_err(|error| error.to_string())?;
    if matches!(response.status, 401 | 403) {
        delete_member_token()?;
        return Err("Member session expired. Sign in again".into());
    }
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    if let Some(refreshed_token) = response.refreshed_token {
        store_member_token(&refreshed_token)?;
    }
    Ok(response.body)
}

#[tauri::command]
pub async fn title_reviews(request: TitleReviewRequest) -> Result<Value, String> {
    validate_review_title(&request.content_type, request.tmdb_id)?;
    let response = fetch_bounded_https_json_request(
        &format!(
            "{MEMBER_API_BASE}/v1/titles/{}/{}/reviews",
            request.content_type, request.tmdb_id
        ),
        JsonRequestMethod::Get,
        None,
        None,
    )
    .await
    .map_err(|error| error.to_string())?;
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    Ok(response.body)
}

#[tauri::command]
pub async fn member_review_eligibility(request: TitleReviewRequest) -> Result<Value, String> {
    validate_review_title(&request.content_type, request.tmdb_id)?;
    let token = load_member_token()?.ok_or("Sign in to review titles")?;
    let response = fetch_bounded_https_json_request(
        &format!(
            "{MEMBER_API_BASE}/v1/titles/{}/{}/review-eligibility",
            request.content_type, request.tmdb_id
        ),
        JsonRequestMethod::Get,
        None,
        Some(&token),
    )
    .await
    .map_err(|error| error.to_string())?;
    if matches!(response.status, 401 | 403) {
        delete_member_token()?;
        return Err("Member session expired. Sign in again".into());
    }
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    if let Some(refreshed_token) = response.refreshed_token {
        store_member_token(&refreshed_token)?;
    }
    Ok(response.body)
}

#[tauri::command]
pub async fn member_write_review(write: MemberReviewWrite) -> Result<Value, String> {
    let normalized_body = normalized_review(&write)?;
    let token = load_member_token()?.ok_or("Sign in to review titles")?;
    let body = serde_json::json!({ "rating": write.rating, "body": normalized_body });
    let response = fetch_bounded_https_json_request(
        &format!(
            "{MEMBER_API_BASE}/v1/titles/{}/{}/review",
            write.content_type, write.tmdb_id
        ),
        JsonRequestMethod::Post,
        Some(&body),
        Some(&token),
    )
    .await
    .map_err(|error| error.to_string())?;
    if matches!(response.status, 401 | 403) {
        delete_member_token()?;
        return Err("Member session expired. Sign in again".into());
    }
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    if let Some(refreshed_token) = response.refreshed_token {
        store_member_token(&refreshed_token)?;
    }
    Ok(response.body)
}

#[tauri::command]
pub async fn member_sign_out() -> Result<MemberSessionStatus, String> {
    if let Some(token) = load_member_token()? {
        let body = serde_json::json!({});
        let _ = fetch_bounded_https_json_request(
            &format!("{MEMBER_API_BASE}/api/auth/sign-out"),
            JsonRequestMethod::Post,
            Some(&body),
            Some(&token),
        )
        .await;
    }
    delete_member_token()?;
    Ok(signed_out_member_status())
}

#[tauri::command]
pub async fn member_state() -> Result<Value, String> {
    let token = load_member_token()?.ok_or("Sign in to use your personal Locadora")?;
    let response = fetch_bounded_https_json_request(
        &format!("{MEMBER_API_BASE}/v1/state"),
        JsonRequestMethod::Get,
        None,
        Some(&token),
    )
    .await
    .map_err(|error| error.to_string())?;
    if matches!(response.status, 401 | 403) {
        delete_member_token()?;
        return Err("Member session expired. Sign in again".into());
    }
    if !(200..300).contains(&response.status) {
        return Err(member_service_error(response.status));
    }
    if let Some(refreshed_token) = response.refreshed_token {
        store_member_token(&refreshed_token)?;
    }
    Ok(response.body)
}

#[tauri::command]
pub fn media_configuration_status() -> Result<Vec<ConfiguredAddon>, String> {
    load_media_configuration().map(|configuration| sanitized_configuration(&configuration))
}

#[tauri::command]
pub fn media_configuration_import_stremio(app: AppHandle) -> Result<StremioImportResult, String> {
    let (leveldb_path, source) = installed_stremio_leveldb(&app)?;
    let values = read_stremio_addon_values(&leveldb_path)?;
    let (addons, skipped) = import_stremio_addons(&values);
    if addons.is_empty() {
        return Err("Installed Stremio has no compatible safe add-ons".into());
    }
    let imported = addons.len();
    let configuration = StoredMediaConfiguration {
        version: MEDIA_CONFIGURATION_VERSION,
        addons,
    };
    store_media_configuration(&configuration)?;
    Ok(StremioImportResult {
        addons: sanitized_configuration(&configuration),
        imported,
        skipped,
        source,
    })
}

#[tauri::command]
pub async fn media_configuration_add(manifest_url: String) -> Result<Vec<ConfiguredAddon>, String> {
    let validated = validate_manifest_url(&manifest_url).map_err(|error| error.to_string())?;
    let manifest = stremio_manifest(validated.clone())
        .await
        .map_err(|error| error.to_string())?;
    let addon = stored_addon_from_manifest(validated.into(), manifest)?;
    let mut configuration = load_media_configuration()?;
    configuration
        .addons
        .retain(|existing| existing.id != addon.id);
    if configuration.addons.len() >= MAX_CONFIGURED_ADDONS {
        return Err("The configured add-on limit has been reached".into());
    }
    configuration.addons.push(addon);
    let mut ids = HashSet::new();
    if configuration
        .addons
        .iter()
        .any(|item| !ids.insert(item.id.as_str()))
    {
        return Err("Protected media configuration is invalid".into());
    }
    store_media_configuration(&configuration)?;
    Ok(sanitized_configuration(&configuration))
}

#[tauri::command]
pub async fn fetch_configured_addon_resource(
    request: ConfiguredResourceRequest,
) -> Result<Value, String> {
    if !matches!(request.resource.as_str(), "stream" | "subtitles" | "meta") {
        return Err("That add-on resource is not available to Locadora".into());
    }
    let configuration = load_media_configuration()?;
    let addon = configuration
        .addons
        .iter()
        .find(|addon| addon.id == request.addon_id)
        .ok_or("Configured add-on was not found")?;
    if !addon_supports(addon, &request.resource, &request.content_type, &request.id) {
        return Err("Configured add-on does not provide that resource".into());
    }
    let transport_url = validate_manifest_url(&addon.manifest_url)
        .map_err(|_| "Protected media configuration is invalid")?;
    let path = ResourcePath::without_extra(&request.resource, &request.content_type, &request.id);
    let response = stremio_resource(transport_url, &path)
        .await
        .map_err(|error| error.to_string())?;
    serde_json::to_value(response).map_err(|_| "Stremio response could not be serialized".into())
}

#[tauri::command]
pub fn media_configuration_remove(addon_id: String) -> Result<Vec<ConfiguredAddon>, String> {
    let mut configuration = load_media_configuration()?;
    configuration.addons.retain(|addon| addon.id != addon_id);
    store_media_configuration(&configuration)?;
    Ok(sanitized_configuration(&configuration))
}

#[tauri::command]
pub fn media_configuration_disconnect() -> Result<(), String> {
    match keyring_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("Protected media storage is unavailable".into()),
    }
}

#[tauri::command]
pub fn player_start(app: AppHandle, state: State<'_, PlayerState>) -> Result<(), String> {
    let mut player = state.0.lock().map_err(|_| "Player state is unavailable")?;
    if player.as_mut().is_some_and(MpvSession::is_alive) {
        return Ok(());
    }
    let runtime_root = app
        .path()
        .app_cache_dir()
        .map_err(|_| "Player cache path is unavailable")?;
    std::fs::create_dir_all(&runtime_root).map_err(|_| "Player cache path is unavailable")?;
    *player = Some(
        MpvSession::start(&runtime_root, VideoOutput::Window).map_err(|error| error.to_string())?,
    );
    Ok(())
}

#[tauri::command]
pub fn player_load(descriptor: String, state: State<'_, PlayerState>) -> Result<(), String> {
    let mut player = state.0.lock().map_err(|_| "Player state is unavailable")?;
    player
        .as_mut()
        .ok_or("Player is not running")?
        .load_remote(&descriptor)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn player_control(
    action: PlayerAction,
    seconds: Option<f64>,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    let mut player = state.0.lock().map_err(|_| "Player state is unavailable")?;
    let player = player.as_mut().ok_or("Player is not running")?;
    match action {
        PlayerAction::Pause => player.set_paused(true),
        PlayerAction::Resume => player.set_paused(false),
        PlayerAction::Seek => player.seek_relative(seconds.ok_or("Seek amount is required")?),
        PlayerAction::Stop => player.stop_media(),
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn player_set_property(
    request: PlayerPropertyRequest,
    state: State<'_, PlayerState>,
) -> Result<(), String> {
    let mut player = state.0.lock().map_err(|_| "Player state is unavailable")?;
    player
        .as_mut()
        .ok_or("Player is not running")?
        .set_property(&request.name, request.value)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn player_events(state: State<'_, PlayerState>) -> Result<Vec<PlayerEvent>, String> {
    let mut player = state.0.lock().map_err(|_| "Player state is unavailable")?;
    Ok(player
        .as_mut()
        .map(MpvSession::drain_events)
        .unwrap_or_default())
}

#[tauri::command]
pub fn player_shutdown(state: State<'_, PlayerState>) -> Result<(), String> {
    let mut player = state.0.lock().map_err(|_| "Player state is unavailable")?;
    *player = None;
    Ok(())
}

#[tauri::command]
pub async fn fetch_public_shelf(request: PublicShelfRequest) -> Result<Value, String> {
    if request.genres.is_empty()
        || request.genres.len() > 3
        || request
            .genres
            .iter()
            .any(|genre| !ALLOWED_GENRES.contains(&genre.as_str()))
        || !(1920..=2200).contains(&request.year)
        || !matches!(request.content_type.as_str(), "movie" | "series")
        || request.stand > 20
    {
        return Err("Invalid public catalogue request".into());
    }
    let genres = request
        .genres
        .iter()
        .map(|genre| encode(genre))
        .collect::<Vec<_>>()
        .join("%2C");
    let url = format!(
        "{PUBLIC_API_BASE}/shelf?genre={genres}&year={}&type={}&stand={}&providers=&ignoreStoreYear=false",
        request.year, request.content_type, request.stand,
    );
    fetch_bounded_https_json(&url)
        .await
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_manifest(value: Value) -> Manifest {
        serde_json::from_value(value).expect("valid official Stremio manifest fixture")
    }

    #[test]
    fn public_shelf_contract_has_a_fixed_origin() {
        assert_eq!(
            PUBLIC_API_BASE,
            "https://locadora-api.willstartpage.workers.dev/v1"
        );
    }

    #[test]
    fn member_contract_has_a_fixed_origin_and_separate_keyring_namespace() {
        assert_eq!(
            MEMBER_API_BASE,
            "https://locadora-data.willstartpage.workers.dev"
        );
        assert_ne!(KEYRING_SERVICE, MEMBER_KEYRING_SERVICE);
        assert_ne!(KEYRING_ACCOUNT, MEMBER_KEYRING_ACCOUNT);
        assert_eq!(
            MEMBER_SIGNUP_CALLBACK,
            "https://willslocadora.sitedoillan.com.br/?verified=1"
        );
    }

    #[test]
    fn member_credentials_are_bounded_before_network_access() {
        assert!(
            validate_member_credentials(&MemberCredentials {
                identifier: "member_name".into(),
                password: "correct horse".into(),
            })
            .is_ok()
        );
        assert!(
            validate_member_credentials(&MemberCredentials {
                identifier: "x".into(),
                password: "correct horse".into(),
            })
            .is_err()
        );
        assert!(
            validate_member_credentials(&MemberCredentials {
                identifier: "member_name".into(),
                password: "short".into(),
            })
            .is_err()
        );
    }

    #[test]
    fn member_signup_normalizes_username_and_rejects_bad_identity_fields() {
        assert_eq!(
            validate_member_signup(&MemberSignup {
                email: "member@example.invalid".into(),
                username: "Will_Rego".into(),
                password: "correct horse".into(),
            })
            .unwrap(),
            "will_rego"
        );
        assert!(
            validate_member_signup(&MemberSignup {
                email: "not-an-email".into(),
                username: "will_rego".into(),
                password: "correct horse".into(),
            })
            .is_err()
        );
        assert!(normalized_member_username("no spaces allowed").is_err());
    }

    #[test]
    fn member_collection_writes_accept_only_fixed_collections_and_canonical_titles() {
        assert!(
            validate_member_collection(&MemberCollectionUpdate {
                collection: "watch_later".into(),
                enabled: true,
                tmdb_id: 603,
                content_type: "movie".into(),
                name: "The Matrix".into(),
                year: Some(1999),
            })
            .is_ok()
        );
        for (collection, content_type, tmdb_id) in [
            ("admin", "movie", 603),
            ("favorite", "../../admin", 603),
            ("favorite", "series", 0),
        ] {
            assert!(
                validate_member_collection(&MemberCollectionUpdate {
                    collection: collection.into(),
                    enabled: false,
                    tmdb_id,
                    content_type: content_type.into(),
                    name: "Tape".into(),
                    year: None,
                })
                .is_err()
            );
        }
    }

    #[test]
    fn member_rentals_are_bounded_to_three_distinct_canonical_titles() {
        let title = || MemberRentalTitle {
            tmdb_id: 603,
            content_type: "movie".into(),
            name: "The Matrix".into(),
            year: Some(1999),
        };
        assert!(
            validate_member_rental(&MemberRentalRequest {
                titles: vec![title()]
            })
            .is_ok()
        );
        assert!(
            validate_member_rental(&MemberRentalRequest {
                titles: vec![title(), title()],
            })
            .is_err()
        );
        assert!(validate_member_rental(&MemberRentalRequest { titles: vec![] }).is_err());
        assert!(
            validate_member_rental(&MemberRentalRequest {
                titles: (0..4)
                    .map(|index| MemberRentalTitle {
                        tmdb_id: 600 + index,
                        ..title()
                    })
                    .collect(),
            })
            .is_err()
        );
    }

    #[test]
    fn member_returns_require_uuid_and_explicit_existing_outcome() {
        for watched_status in ["watched", "not_watched", "unknown"] {
            assert!(
                validate_member_return(&MemberReturnRequest {
                    item_id: "11111111-1111-4111-8111-111111111111".into(),
                    watched_status: watched_status.into(),
                })
                .is_ok()
            );
        }
        assert!(
            validate_member_return(&MemberReturnRequest {
                item_id: "../../admin".into(),
                watched_status: "watched".into(),
            })
            .is_err()
        );
        assert!(
            validate_member_return(&MemberReturnRequest {
                item_id: "11111111-1111-4111-8111-111111111111".into(),
                watched_status: "autoplayed".into(),
            })
            .is_err()
        );
    }

    #[test]
    fn member_history_offsets_match_the_worker_bound() {
        assert!(validate_history_offset(0).is_ok());
        assert!(validate_history_offset(10_000).is_ok());
        assert!(validate_history_offset(10_001).is_err());
    }

    #[test]
    fn reviews_require_canonical_titles_half_stars_and_bounded_text() {
        let valid = MemberReviewWrite {
            tmdb_id: 603,
            content_type: "movie".into(),
            rating: 4.5,
            body: "  Muito   bom.\nMesmo. ".into(),
        };
        assert_eq!(normalized_review(&valid).unwrap(), "Muito bom. Mesmo.");
        for (content_type, tmdb_id, rating, body) in [
            ("episode", 603, 4.5, "Good"),
            ("movie", 0, 4.5, "Good"),
            ("movie", 603, 4.2, "Good"),
            ("movie", 603, 5.0, "   "),
        ] {
            assert!(
                normalized_review(&MemberReviewWrite {
                    tmdb_id,
                    content_type: content_type.into(),
                    rating,
                    body: body.into(),
                })
                .is_err()
            );
        }
    }

    #[test]
    fn member_session_exposes_only_bounded_identity_fields() {
        let body = serde_json::json!({
            "user": {
                "id": "member-id",
                "username": "will",
                "email": "private@example.invalid",
                "token": "must-not-leak"
            },
            "session": { "token": "also-private" }
        });
        let status = member_session_from_body(&body).unwrap();
        let serialized = serde_json::to_string(&status).unwrap();
        assert_eq!(status.user.unwrap().username.as_deref(), Some("will"));
        assert!(!serialized.contains("private@example.invalid"));
        assert!(!serialized.contains("must-not-leak"));
        assert!(!serialized.contains("also-private"));
    }

    #[test]
    fn genre_allowlist_matches_the_shared_browse_contract() {
        assert!(ALLOWED_GENRES.contains(&"Action"));
        assert!(!ALLOWED_GENRES.contains(&"../../admin"));
    }

    #[test]
    fn manifest_summary_never_contains_the_manifest_url() {
        let stored = stored_addon_from_manifest(
            "https://example.invalid/private/manifest.json?token=secret".into(),
            fixture_manifest(serde_json::json!({
                "id": "org.example.safe",
                "name": "Fixture",
                "version": "1.0.0",
                "types": ["movie", "series"],
                "resources": ["stream", { "name": "subtitles" }]
            })),
        )
        .unwrap();
        let sanitized = sanitized_configuration(&StoredMediaConfiguration {
            version: MEDIA_CONFIGURATION_VERSION,
            addons: vec![stored],
        });
        let serialized = serde_json::to_string(&sanitized).unwrap();
        assert!(!serialized.contains("secret"));
        assert!(!serialized.contains("manifest.json"));
        assert!(serialized.contains("org.example.safe"));
    }

    #[test]
    fn chromium_utf16_local_storage_values_decode_without_exposing_other_records() {
        let json = r#"[{"transportUrl":"https://example.invalid/manifest.json"}]"#;
        let mut stored = vec![0];
        stored.extend(json.encode_utf16().flat_map(u16::to_le_bytes));
        assert_eq!(decode_chromium_local_storage_string(&stored).unwrap(), json);
    }

    #[test]
    fn stremio_import_keeps_safe_descriptors_and_reports_unsafe_ones() {
        let values = serde_json::json!([{
            "transportUrl": "https://example.invalid/manifest.json",
            "manifest": {
                "id": "org.example.catalog",
                "name": "Catalog",
                "version": "1.0.0",
                "types": ["movie"],
                "resources": ["catalog"]
            }
        }, {
            "transportUrl": "http://127.0.0.1:11470/local/manifest.json",
            "manifest": {
                "id": "org.example.local",
                "name": "Local Files",
                "version": "1.0.0",
                "types": ["movie"],
                "resources": ["stream"]
            }
        }]);
        let (addons, skipped) = import_stremio_addons(values.as_array().unwrap());
        assert_eq!(addons.len(), 1);
        assert_eq!(addons[0].id, "org.example.catalog");
        assert_eq!(
            skipped,
            vec![SkippedStremioAddon {
                name: "Local Files".into(),
                reason: "unsafe or unsupported transport".into(),
            }]
        );
    }

    #[test]
    #[ignore = "reads the caller-provided installed Stremio LevelDB path"]
    fn installed_stremio_collection_is_importable_without_emitting_secrets() {
        let path = std::env::var_os("LOCADORA_STREMIO_LEVELDB")
            .map(PathBuf::from)
            .expect("LOCADORA_STREMIO_LEVELDB");
        let values = read_stremio_addon_values(&path).expect("read installed Stremio collection");
        let (addons, skipped) = import_stremio_addons(&values);
        assert!(!addons.is_empty());
        assert!(addons.iter().any(|addon| addon.id == "com.linvo.cinemeta"));
        assert!(
            addons
                .iter()
                .any(|addon| addon.id == "com.stremio.torrentio.addon")
        );
        assert!(addons.iter().any(|addon| addon.id == "org.imdbcatalogs"));
        assert!(skipped.iter().all(|addon| !addon.name.is_empty()));
    }

    #[test]
    fn catalog_only_manifests_are_retained_without_becoming_playback_sources() {
        let stored = stored_addon_from_manifest(
            "https://example.invalid/manifest.json".into(),
            fixture_manifest(serde_json::json!({
                "id": "org.example.catalog",
                "name": "Catalog only",
                "version": "1.0.0",
                "types": ["movie"],
                "resources": ["catalog"]
            })),
        )
        .unwrap();
        assert_eq!(addon_resource_names(&stored), vec!["catalog"]);
        assert!(!addon_supports_resource_name(&stored, "stream"));
    }

    #[test]
    fn manifest_must_supply_a_supported_resource() {
        let result = stored_addon_from_manifest(
            "https://example.invalid/manifest.json".into(),
            fixture_manifest(serde_json::json!({
                "id": "org.example.unknown",
                "name": "Unknown",
                "version": "1.0.0",
                "types": ["movie"],
                "resources": ["custom"]
            })),
        );
        assert!(result.is_err());
    }

    #[test]
    fn resource_filters_preserve_type_and_id_prefix_compatibility() {
        let stored = stored_addon_from_manifest(
            "https://example.invalid/manifest.json".into(),
            fixture_manifest(serde_json::json!({
                "id": "org.example.filters",
                "name": "Filtered",
                "version": "1.0.0",
                "types": ["movie", "series"],
                "resources": [
                    { "name": "stream", "types": ["movie"], "idPrefixes": ["tt"] },
                    { "name": "subtitles", "types": ["series"] }
                ]
            })),
        )
        .unwrap();
        assert!(addon_supports(&stored, "stream", "movie", "tt1254207"));
        assert!(!addon_supports(&stored, "stream", "series", "tt1254207"));
        assert!(!addon_supports(&stored, "stream", "movie", "custom:1"));
        assert!(addon_supports(&stored, "subtitles", "series", "custom:1"));
    }

    #[test]
    fn legacy_configuration_retains_declared_capabilities() {
        let mut configuration: StoredMediaConfiguration =
            serde_json::from_value(serde_json::json!({
                "version": 1,
                "addons": [{
                    "manifestUrl": "https://example.invalid/manifest.json",
                    "id": "org.example.legacy",
                    "name": "Legacy",
                    "supportsStreams": true,
                    "supportsSubtitles": false
                }]
            }))
            .unwrap();
        migrate_media_configuration(&mut configuration);
        assert_eq!(configuration.version, MEDIA_CONFIGURATION_VERSION);
        assert!(addon_supports(
            &configuration.addons[0],
            "stream",
            "movie",
            "tt1254207"
        ));
        assert!(!addon_supports(
            &configuration.addons[0],
            "subtitles",
            "movie",
            "tt1254207"
        ));
    }

    #[test]
    #[ignore = "writes a synthetic value to the OS credential store and deletes it"]
    fn keyring_roundtrip_uses_os_credential_store() {
        let entry = keyring_entry_for("integration-test-do-not-use").expect("create keyring entry");
        let expected = "synthetic-test-value";
        entry
            .set_password(expected)
            .expect("store synthetic credential");
        let actual = entry.get_password().expect("read synthetic credential");
        entry
            .delete_credential()
            .expect("delete synthetic credential");
        assert_eq!(actual, expected);
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
    }
}
