use chrono::{DateTime, FixedOffset, Utc};
use futures::{Future, future};
use http::{Method, Request};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use stremio_core::{
    addon_transport::{AddonHTTPTransport, AddonTransport},
    models::{ctx::Ctx, streaming_server::StreamingServer},
    runtime::{ConditionalSend, Env, EnvError, EnvFuture, EnvFutureExt, TryEnvFuture},
    types::addon::{Manifest, ResourcePath, ResourceResponse},
};
use thiserror::Error;
use url::Url;

use crate::network::fetch_bounded_https_json;

#[derive(Debug, Error)]
pub enum StremioCoreError {
    #[error("Stremio rejected the add-on manifest")]
    Manifest,
    #[error("Stremio rejected the add-on response")]
    Resource,
}

/// Native environment used only by the official Stremio add-on transport.
/// Storage remains owned by the shell's OS credential-store adapter.
struct SecureStremioEnv;

impl Env for SecureStremioEnv {
    fn fetch<
        IN: Serialize + ConditionalSend + 'static,
        OUT: for<'de> Deserialize<'de> + ConditionalSend + 'static,
    >(
        request: Request<IN>,
    ) -> TryEnvFuture<OUT> {
        if request.method() != Method::GET {
            return future::err(EnvError::Fetch("Unsupported request method".into())).boxed_env();
        }
        let url = request.uri().to_string();
        async move {
            let body = fetch_bounded_https_json(&url)
                .await
                .map_err(|error| EnvError::Fetch(error.to_string()))?;
            serde_json::from_value(body)
                .map_err(|_| EnvError::Serde("Invalid Stremio response".into()))
        }
        .boxed_env()
    }

    fn get_storage<T: for<'de> Deserialize<'de> + ConditionalSend + 'static>(
        _key: &str,
    ) -> TryEnvFuture<Option<T>> {
        future::ok(None).boxed_env()
    }

    fn set_storage<T: Serialize>(_key: &str, _value: Option<&T>) -> TryEnvFuture<()> {
        future::ok(()).boxed_env()
    }

    fn exec_concurrent<F: Future<Output = ()> + ConditionalSend + 'static>(future: F) {
        std::thread::spawn(move || futures::executor::block_on(future));
    }

    fn exec_sequential<F: Future<Output = ()> + ConditionalSend + 'static>(future: F) {
        std::thread::spawn(move || futures::executor::block_on(future));
    }

    fn now() -> DateTime<Utc> {
        Utc::now()
    }

    fn local_now() -> DateTime<FixedOffset> {
        Utc::now().fixed_offset()
    }

    fn flush_analytics() -> EnvFuture<'static, ()> {
        future::ready(()).boxed_env()
    }

    fn analytics_context(_ctx: &Ctx, _streaming_server: &StreamingServer, _path: &str) -> Value {
        Value::Null
    }

    #[cfg(debug_assertions)]
    fn log(_message: String) {
        // Core debug messages may contain media data; the desktop boundary is silent.
    }
}

pub async fn stremio_manifest(transport_url: Url) -> Result<Manifest, StremioCoreError> {
    AddonHTTPTransport::<SecureStremioEnv>::new(transport_url)
        .manifest()
        .await
        .map_err(|_| StremioCoreError::Manifest)
}

pub async fn stremio_resource(
    transport_url: Url,
    path: &ResourcePath,
) -> Result<ResourceResponse, StremioCoreError> {
    AddonHTTPTransport::<SecureStremioEnv>::new(transport_url)
        .resource(path)
        .await
        .map_err(|_| StremioCoreError::Resource)
}

#[cfg(test)]
mod tests {
    use stremio_core::types::addon::Manifest;

    #[test]
    fn official_core_owns_manifest_compatibility() {
        let manifest: Manifest = serde_json::from_value(serde_json::json!({
            "id": "org.example.fixture",
            "version": "1.0.0",
            "name": "Fixture",
            "description": "Synthetic",
            "types": ["movie", "series"],
            "resources": [
                { "name": "stream", "types": ["movie"], "idPrefixes": ["tt"] },
                "subtitles"
            ]
        }))
        .expect("official Stremio manifest");

        assert!(manifest.is_resource_supported(
            &stremio_core::types::addon::ResourcePath::without_extra(
                "stream",
                "movie",
                "tt1254207"
            )
        ));
        assert!(!manifest.is_resource_supported(
            &stremio_core::types::addon::ResourcePath::without_extra(
                "stream",
                "series",
                "tt1254207"
            )
        ));
    }
}
