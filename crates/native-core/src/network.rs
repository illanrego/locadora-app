use futures_util::StreamExt;
use reqwest::{Client, StatusCode, header};
use serde_json::Value;
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs},
    time::Duration,
};
use thiserror::Error;
use url::{Host, Url};

pub const MAX_JSON_BYTES: usize = 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Debug, Error)]
pub enum NativeNetworkError {
    #[error("Invalid remote URL")]
    InvalidUrl,
    #[error("Remote requests must use HTTPS")]
    HttpsRequired,
    #[error("URL credentials are not allowed")]
    CredentialsNotAllowed,
    #[error("URL must point to manifest.json")]
    ManifestPathRequired,
    #[error("Private-network destinations are not allowed")]
    PrivateNetwork,
    #[error("Remote host could not be resolved")]
    ResolutionFailed,
    #[error("Remote request timed out")]
    Timeout,
    #[error("Remote request failed")]
    RequestFailed,
    #[error("Remote response is too large")]
    ResponseTooLarge,
    #[error("Remote response is not valid JSON")]
    InvalidJson,
    #[error("Remote source returned too many redirects")]
    TooManyRedirects,
}

fn is_private_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_unspecified()
        || octets[0] == 0
        || (octets[0] == 100 && (64..=127).contains(&octets[1]))
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 0)
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19))
        || octets[0] >= 224
}

fn is_private_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(ipv4) = ip.to_ipv4_mapped() {
        return is_private_ipv4(ipv4);
    }
    let segments = ip.segments();
    ip.is_loopback()
        || ip.is_unspecified()
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] & 0xff00) == 0xff00
}

fn is_private_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_private_ipv4(ip),
        IpAddr::V6(ip) => is_private_ipv6(ip),
    }
}

fn validate_https_url(value: &str) -> Result<Url, NativeNetworkError> {
    let mut url = Url::parse(value).map_err(|_| NativeNetworkError::InvalidUrl)?;
    if url.scheme() != "https" {
        return Err(NativeNetworkError::HttpsRequired);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(NativeNetworkError::CredentialsNotAllowed);
    }
    match url.host().ok_or(NativeNetworkError::InvalidUrl)? {
        Host::Domain(host)
            if host.eq_ignore_ascii_case("localhost") || host.ends_with(".localhost") =>
        {
            return Err(NativeNetworkError::PrivateNetwork);
        }
        Host::Ipv4(ip) if is_private_ipv4(ip) => return Err(NativeNetworkError::PrivateNetwork),
        Host::Ipv6(ip) if is_private_ipv6(ip) => return Err(NativeNetworkError::PrivateNetwork),
        _ => {}
    }
    url.set_fragment(None);
    Ok(url)
}

pub fn validate_manifest_url(value: &str) -> Result<Url, NativeNetworkError> {
    let url = validate_https_url(value)?;
    if !url.path().ends_with("/manifest.json") {
        return Err(NativeNetworkError::ManifestPathRequired);
    }
    Ok(url)
}

pub fn build_addon_resource_url(
    manifest_url: &str,
    resource: &str,
    content_type: &str,
    id: &str,
) -> Result<Url, NativeNetworkError> {
    if !matches!(resource, "stream" | "subtitles" | "meta")
        || !matches!(content_type, "movie" | "series")
        || id.is_empty()
        || id.len() > 180
    {
        return Err(NativeNetworkError::InvalidUrl);
    }
    let mut url = validate_manifest_url(manifest_url)?;
    let root = url.path().trim_end_matches("/manifest.json");
    let encoded_id: String = url::form_urlencoded::byte_serialize(id.as_bytes()).collect();
    url.set_path(&format!(
        "{root}/{resource}/{content_type}/{encoded_id}.json"
    ));
    url.set_query(None);
    Ok(url)
}

fn resolve_public_addresses(url: &Url) -> Result<(String, Vec<SocketAddr>), NativeNetworkError> {
    let host = match url.host().ok_or(NativeNetworkError::InvalidUrl)? {
        Host::Domain(host) => host.to_owned(),
        Host::Ipv4(ip) => ip.to_string(),
        Host::Ipv6(ip) => ip.to_string(),
    };
    let port = url
        .port_or_known_default()
        .ok_or(NativeNetworkError::InvalidUrl)?;
    let addresses: Vec<_> = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|_| NativeNetworkError::ResolutionFailed)?
        .collect();
    if addresses.is_empty() {
        return Err(NativeNetworkError::ResolutionFailed);
    }
    if addresses.iter().any(|address| is_private_ip(address.ip())) {
        return Err(NativeNetworkError::PrivateNetwork);
    }
    Ok((host, addresses))
}

fn pinned_client(host: &str, addresses: &[SocketAddr]) -> Result<Client, NativeNetworkError> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(TIMEOUT)
        .resolve_to_addrs(host, addresses)
        .build()
        .map_err(|_| NativeNetworkError::RequestFailed)
}

pub async fn fetch_bounded_https_json(input: &str) -> Result<Value, NativeNetworkError> {
    let mut target = validate_https_url(input)?;
    for redirect_count in 0..=MAX_REDIRECTS {
        let (host, addresses) = resolve_public_addresses(&target)?;
        let client = pinned_client(&host, &addresses)?;
        let response = client
            .get(target.clone())
            .header(header::ACCEPT, "application/json")
            .header(header::USER_AGENT, "WillsLocadoraPlayer/0.1")
            .send()
            .await
            .map_err(|error| {
                if error.is_timeout() {
                    NativeNetworkError::Timeout
                } else {
                    NativeNetworkError::RequestFailed
                }
            })?;

        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err(NativeNetworkError::TooManyRedirects);
            }
            let location = response
                .headers()
                .get(header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .ok_or(NativeNetworkError::RequestFailed)?;
            let next = target
                .join(location)
                .map_err(|_| NativeNetworkError::InvalidUrl)?;
            target = validate_https_url(next.as_str())?;
            continue;
        }

        if response.status() != StatusCode::OK {
            return Err(NativeNetworkError::RequestFailed);
        }
        if response
            .content_length()
            .is_some_and(|length| length > MAX_JSON_BYTES as u64)
        {
            return Err(NativeNetworkError::ResponseTooLarge);
        }

        let mut bytes = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| NativeNetworkError::RequestFailed)?;
            if bytes.len() + chunk.len() > MAX_JSON_BYTES {
                return Err(NativeNetworkError::ResponseTooLarge);
            }
            bytes.extend_from_slice(&chunk);
        }
        return serde_json::from_slice(&bytes).map_err(|_| NativeNetworkError::InvalidJson);
    }
    Err(NativeNetworkError::TooManyRedirects)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_secret_bearing_https_manifest_without_exposing_it() {
        let url = validate_manifest_url(
            "https://addon.example.invalid/private-token/manifest.json?key=secret",
        )
        .unwrap();
        assert_eq!(url.scheme(), "https");
    }

    #[test]
    fn builds_only_allowlisted_addon_resources() {
        let url = build_addon_resource_url(
            "https://addon.example.invalid/config/manifest.json?token=secret",
            "stream",
            "movie",
            "tt1254207",
        )
        .unwrap();
        assert_eq!(
            url.as_str(),
            "https://addon.example.invalid/config/stream/movie/tt1254207.json"
        );
        assert!(
            build_addon_resource_url(
                "https://addon.example.invalid/manifest.json",
                "proxy",
                "movie",
                "tt1"
            )
            .is_err()
        );
    }

    #[test]
    fn rejects_local_private_and_credentialed_urls() {
        for value in [
            "http://example.com/manifest.json",
            "https://localhost/manifest.json",
            "https://127.0.0.1/manifest.json",
            "https://10.0.0.1/manifest.json",
            "https://[::1]/manifest.json",
            "https://user:pass@example.com/manifest.json",
        ] {
            assert!(validate_manifest_url(value).is_err(), "accepted {value}");
        }
    }

    #[test]
    fn errors_never_contain_the_input_url() {
        let secret = "not-a-url-with-a-secret";
        let error = validate_manifest_url(secret).unwrap_err().to_string();
        assert!(!error.contains(secret));
    }
}
