use locadora_native_core::{
    MpvSession, NativeCapabilities, PlayerEvent, VideoOutput, build_addon_resource_url,
    fetch_bounded_https_json, native_capabilities as read_native_capabilities,
    validate_manifest_url,
};
use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, sync::Mutex};
use tauri::{AppHandle, Manager, State};
use urlencoding::encode;

const PUBLIC_API_BASE: &str = "https://locadora-api.willstartpage.workers.dev/v1";
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
const MEDIA_CONFIGURATION_VERSION: u8 = 2;
const MAX_CONFIGURED_ADDONS: usize = 12;
const MAX_MANIFEST_RESOURCES: usize = 64;
const MAX_RESOURCE_FILTERS: usize = 64;

#[derive(Default)]
pub struct PlayerState(Mutex<Option<MpvSession>>);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AddonJsonRequest {
    manifest_url: String,
    resource: String,
    content_type: Option<String>,
    id: Option<String>,
}

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
pub struct PublicShelfRequest {
    genres: Vec<String>,
    year: u16,
    content_type: String,
    stand: u8,
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
    supports_streams: bool,
    supports_subtitles: bool,
}

fn keyring_entry() -> Result<keyring::Entry, String> {
    keyring_entry_for(KEYRING_ACCOUNT)
}

fn keyring_entry_for(account: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(KEYRING_SERVICE, account)
        .map_err(|_| "Protected media storage is unavailable".into())
}

fn migrate_media_configuration(configuration: &mut StoredMediaConfiguration) {
    if configuration.version != 1 {
        return;
    }
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
    configuration.version = MEDIA_CONFIGURATION_VERSION;
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
            supports_streams: addon
                .resources
                .iter()
                .any(|resource| resource.name == "stream"),
            supports_subtitles: addon
                .resources
                .iter()
                .any(|resource| resource.name == "subtitles"),
        })
        .collect()
}

fn string_array(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .filter(|item| !item.is_empty() && item.len() <= 160)
                .take(MAX_RESOURCE_FILTERS)
                .map(ToOwned::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn manifest_resources(value: &Value) -> Vec<StoredResource> {
    let default_types = string_array(value.get("types"));
    let default_prefixes = string_array(value.get("idPrefixes"));
    value
        .get("resources")
        .and_then(Value::as_array)
        .map(|resources| {
            resources
                .iter()
                .filter_map(|resource| {
                    if let Some(name) = resource.as_str() {
                        return matches!(name, "stream" | "subtitles" | "meta").then(|| {
                            StoredResource {
                                name: name.into(),
                                types: default_types.clone(),
                                id_prefixes: default_prefixes.clone(),
                            }
                        });
                    }
                    let name = resource.get("name").and_then(Value::as_str)?;
                    if !matches!(name, "stream" | "subtitles" | "meta") {
                        return None;
                    }
                    let types = string_array(resource.get("types"));
                    let id_prefixes = string_array(resource.get("idPrefixes"));
                    Some(StoredResource {
                        name: name.into(),
                        types: if types.is_empty() {
                            default_types.clone()
                        } else {
                            types
                        },
                        id_prefixes: if id_prefixes.is_empty() {
                            default_prefixes.clone()
                        } else {
                            id_prefixes
                        },
                    })
                })
                .take(MAX_MANIFEST_RESOURCES)
                .collect()
        })
        .unwrap_or_default()
}

fn addon_supports(addon: &StoredAddon, resource_name: &str, content_type: &str, id: &str) -> bool {
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

fn stored_addon_from_manifest(manifest_url: String, value: &Value) -> Result<StoredAddon, String> {
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if id.is_empty() || id.len() > 160 || name.is_empty() || name.len() > 160 {
        return Err("Add-on manifest is invalid".into());
    }
    let resources = manifest_resources(value);
    if !resources
        .iter()
        .any(|resource| matches!(resource.name.as_str(), "stream" | "subtitles"))
    {
        return Err("Add-on does not provide streams or subtitles".into());
    }
    Ok(StoredAddon {
        manifest_url,
        id: id.into(),
        name: name.into(),
        resources,
        supports_streams: false,
        supports_subtitles: false,
    })
}

#[tauri::command]
pub fn native_capabilities() -> NativeCapabilities {
    read_native_capabilities()
}

#[tauri::command]
pub fn media_configuration_status() -> Result<Vec<ConfiguredAddon>, String> {
    load_media_configuration().map(|configuration| sanitized_configuration(&configuration))
}

#[tauri::command]
pub async fn media_configuration_add(manifest_url: String) -> Result<Vec<ConfiguredAddon>, String> {
    let validated = validate_manifest_url(&manifest_url).map_err(|error| error.to_string())?;
    let manifest = fetch_bounded_https_json(validated.as_str())
        .await
        .map_err(|error| error.to_string())?;
    let addon = stored_addon_from_manifest(validated.into(), &manifest)?;
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
    let configuration = load_media_configuration()?;
    let addon = configuration
        .addons
        .iter()
        .find(|addon| addon.id == request.addon_id)
        .ok_or("Configured add-on was not found")?;
    if !addon_supports(addon, &request.resource, &request.content_type, &request.id) {
        return Err("Configured add-on does not provide that resource".into());
    }
    let url = build_addon_resource_url(
        &addon.manifest_url,
        &request.resource,
        &request.content_type,
        &request.id,
    )
    .map_err(|error| error.to_string())?;
    fetch_bounded_https_json(url.as_str())
        .await
        .map_err(|error| error.to_string())
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
pub async fn fetch_addon_json(request: AddonJsonRequest) -> Result<Value, String> {
    let url = match request.resource.as_str() {
        "manifest" => validate_manifest_url(&request.manifest_url),
        "stream" | "subtitles" | "meta" => build_addon_resource_url(
            &request.manifest_url,
            &request.resource,
            request.content_type.as_deref().unwrap_or_default(),
            request.id.as_deref().unwrap_or_default(),
        ),
        _ => return Err("Unsupported add-on resource".into()),
    }
    .map_err(|error| error.to_string())?;
    fetch_bounded_https_json(url.as_str())
        .await
        .map_err(|error| error.to_string())
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

    #[test]
    fn public_shelf_contract_has_a_fixed_origin() {
        assert_eq!(
            PUBLIC_API_BASE,
            "https://locadora-api.willstartpage.workers.dev/v1"
        );
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
            &serde_json::json!({
                "id": "org.example.safe",
                "name": "Fixture",
                "resources": ["stream", { "name": "subtitles" }]
            }),
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
    fn manifest_must_supply_media_resources() {
        let result = stored_addon_from_manifest(
            "https://example.invalid/manifest.json".into(),
            &serde_json::json!({ "id": "org.example.catalog", "name": "Catalog only", "resources": ["catalog"] }),
        );
        assert!(result.is_err());
    }

    #[test]
    fn resource_filters_preserve_type_and_id_prefix_compatibility() {
        let stored = stored_addon_from_manifest(
            "https://example.invalid/manifest.json".into(),
            &serde_json::json!({
                "id": "org.example.filters",
                "name": "Filtered",
                "types": ["movie", "series"],
                "resources": [
                    { "name": "stream", "types": ["movie"], "idPrefixes": ["tt"] },
                    { "name": "subtitles", "types": ["series"] }
                ]
            }),
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
