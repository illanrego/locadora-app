use locadora_native_core::{
    NativeCapabilities, build_addon_resource_url, fetch_bounded_https_json,
    native_capabilities as read_native_capabilities, validate_manifest_url,
};
use serde::Deserialize;
use serde_json::Value;
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

#[tauri::command]
pub fn native_capabilities() -> NativeCapabilities {
    read_native_capabilities()
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
