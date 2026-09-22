use locadora_native_core::{
    MpvSession, NativeCapabilities, PlayerEvent, VideoOutput, build_addon_resource_url,
    fetch_bounded_https_json, native_capabilities as read_native_capabilities,
    validate_manifest_url,
};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Mutex;
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

#[tauri::command]
pub fn native_capabilities() -> NativeCapabilities {
    read_native_capabilities()
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
}
