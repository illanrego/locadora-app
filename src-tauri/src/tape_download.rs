//! Native discard-only drain. Engine B owns all media storage; this module has no file I/O.
use crate::streaming_engine::{TAPE_URL, tape_engine_ensure};
use serde::Serialize;
use std::{
    future::{Future, poll_fn},
    sync::{Arc, Mutex},
    task::Poll,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State, async_runtime};

const EVENT: &str = "tape-download-progress";
const MAX_BYTES: u64 = 16 * 1024 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const READ_TIMEOUT: Duration = Duration::from_secs(120);
const TOTAL_TIMEOUT: Duration = Duration::from_secs(48 * 60 * 60);
const PROGRESS_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DownloadErrorCode {
    EngineUnavailable,
    TorrentNotFound,
    InvalidRequest,
    ReadFailed,
    TooLarge,
    Cancelled,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct DownloadError {
    code: DownloadErrorCode,
    message: &'static str,
}

impl From<DownloadErrorCode> for DownloadError {
    fn from(code: DownloadErrorCode) -> Self {
        let message = match code {
            DownloadErrorCode::EngineUnavailable => "The tape engine is unavailable.",
            DownloadErrorCode::TorrentNotFound => "The tape torrent or file was not found.",
            DownloadErrorCode::InvalidRequest => "Invalid tape download request.",
            DownloadErrorCode::ReadFailed => "Could not finish reading the tape.",
            DownloadErrorCode::TooLarge => "The tape exceeds the 16 GiB download limit.",
            DownloadErrorCode::Cancelled => "Tape download cancelled.",
        };
        Self { code, message }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum DownloadStatus {
    Reading,
    Complete,
    Cancelled,
    Failed,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadProgress {
    info_hash: String,
    file_idx: u16,
    read_bytes: u64,
    total_bytes: Option<u64>,
    state: DownloadStatus,
}

impl DownloadProgress {
    fn request(hash: &serde_json::Value, index: &serde_json::Value) -> Result<Self, DownloadError> {
        let hash = hash.as_str().ok_or(DownloadErrorCode::InvalidRequest)?;
        let index = index.as_u64().ok_or(DownloadErrorCode::InvalidRequest)?;
        if hash.len() != 40
            || !hash
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            || index > 9_999
        {
            return Err(DownloadErrorCode::InvalidRequest.into());
        }
        Ok(Self {
            info_hash: hash.to_owned(),
            file_idx: index as u16,
            read_bytes: 0,
            total_bytes: None,
            state: DownloadStatus::Reading,
        })
    }

    fn url(&self) -> String {
        format!("{TAPE_URL}{}/{}", self.info_hash, self.file_idx)
    }

    fn add_bytes(&mut self, count: u64) -> Result<(), DownloadError> {
        let next = self
            .read_bytes
            .checked_add(count)
            .ok_or(DownloadErrorCode::TooLarge)?;
        check_size(next)?;
        if self.total_bytes.is_some_and(|total| next > total) {
            return Err(DownloadErrorCode::ReadFailed.into());
        }
        self.read_bytes = next;
        Ok(())
    }

    fn check_eof(&self) -> Result<(), DownloadError> {
        if self
            .total_bytes
            .is_some_and(|total| self.read_bytes != total)
        {
            Err(DownloadErrorCode::ReadFailed.into())
        } else {
            Ok(())
        }
    }
}

fn check_size(bytes: u64) -> Result<(), DownloadError> {
    if bytes > MAX_BYTES {
        Err(DownloadErrorCode::TooLarge.into())
    } else {
        Ok(())
    }
}

#[derive(Default)]
pub struct DownloadState {
    active: Arc<Mutex<Option<async_runtime::Sender<()>>>>,
}

impl DownloadState {
    fn start(&self, progress: DownloadProgress) -> Result<Download, DownloadError> {
        let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if active.is_some() {
            return Err(DownloadError {
                code: DownloadErrorCode::InvalidRequest,
                message: "A tape download is already active.",
            });
        }
        let (sender, receiver) = async_runtime::channel(1);
        *active = Some(sender);
        Ok(Download {
            active: self.active.clone(),
            cancel: receiver,
            progress,
            finished: false,
        })
    }

    pub fn cancel(&self) {
        let active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(sender) = active.as_ref() {
            // A full channel already contains the cancellation. Keep the slot reserved
            // until the response has been dropped and the terminal event emitted.
            let _ = sender.try_send(());
        }
    }
}

struct Download {
    active: Arc<Mutex<Option<async_runtime::Sender<()>>>>,
    cancel: async_runtime::Receiver<()>,
    progress: DownloadProgress,
    finished: bool,
}

// Tauri re-exports the channel but not select!. Polling the two futures with
// std keeps cancellation wake-driven without adding a runtime dependency.
async fn cancellable<T>(
    cancel: &mut async_runtime::Receiver<()>,
    future: impl Future<Output = Result<T, DownloadError>>,
) -> Result<T, DownloadError> {
    let mut future = std::pin::pin!(future);
    poll_fn(|cx| {
        if cancel.poll_recv(cx).is_ready() {
            return Poll::Ready(Err(DownloadErrorCode::Cancelled.into()));
        }
        future.as_mut().poll(cx)
    })
    .await
}

fn client(read_timeout: Duration) -> Result<reqwest::Client, DownloadError> {
    reqwest::Client::builder()
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .http1_only()
        .pool_max_idle_per_host(0)
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .connect_timeout(CONNECT_TIMEOUT)
        .read_timeout(read_timeout)
        .timeout(TOTAL_TIMEOUT)
        .build()
        .map_err(|_| DownloadErrorCode::ReadFailed.into())
}

fn response_total(response: &reqwest::Response) -> Result<Option<u64>, DownloadError> {
    match response.status().as_u16() {
        200 => (),
        404 => return Err(DownloadErrorCode::TorrentNotFound.into()),
        502..=504 => return Err(DownloadErrorCode::EngineUnavailable.into()),
        // Includes redirects and unsolicited partial content: neither proves a full tape.
        _ => return Err(DownloadErrorCode::ReadFailed.into()),
    }
    let headers = response.headers();
    if headers.contains_key(reqwest::header::CONTENT_RANGE)
        || headers
            .get(reqwest::header::CONTENT_ENCODING)
            .is_some_and(|value| value != "identity")
    {
        return Err(DownloadErrorCode::ReadFailed.into());
    }
    let total = headers
        .get(reqwest::header::CONTENT_LENGTH)
        .map(|value| {
            value
                .to_str()
                .ok()
                .and_then(|text| text.parse::<u64>().ok())
                .ok_or(DownloadErrorCode::ReadFailed)
        })
        .transpose()?;
    if let Some(total) = total {
        check_size(total)?;
    }
    Ok(total)
}

impl Download {
    async fn run(
        mut self,
        ensure: impl Future<Output = Result<(), DownloadError>>,
        // Private transport seam for synthetic loopback tests. IPC never accepts a URL.
        url: &str,
        read_timeout: Duration,
        mut emit: impl FnMut(&DownloadProgress),
    ) -> Result<(), DownloadError> {
        let result = self.read(ensure, url, read_timeout, &mut emit).await;
        // Serialize cancellation against completion and slot release. No successor can
        // start before this download's response is dropped and terminal event is sent.
        let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        let result = if self.cancel.try_recv().is_ok() {
            Err(DownloadErrorCode::Cancelled.into())
        } else {
            result
        };
        self.progress.state = match result {
            Ok(()) => DownloadStatus::Complete,
            Err(DownloadError {
                code: DownloadErrorCode::Cancelled,
                ..
            }) => DownloadStatus::Cancelled,
            Err(_) => DownloadStatus::Failed,
        };
        emit(&self.progress);
        *active = None;
        self.finished = true;
        result
    }

    async fn read(
        &mut self,
        ensure: impl Future<Output = Result<(), DownloadError>>,
        url: &str,
        read_timeout: Duration,
        emit: &mut impl FnMut(&DownloadProgress),
    ) -> Result<(), DownloadError> {
        cancellable(&mut self.cancel, ensure).await?;
        let client = client(read_timeout)?;
        let mut response = cancellable(&mut self.cancel, async {
            client
                .get(url)
                .header(reqwest::header::ACCEPT_ENCODING, "identity")
                .send()
                .await
                .map_err(|error| {
                    if error.is_connect() {
                        DownloadErrorCode::EngineUnavailable.into()
                    } else {
                        DownloadErrorCode::ReadFailed.into()
                    }
                })
        })
        .await?;
        self.progress.total_bytes = response_total(&response)?;
        emit(&self.progress);
        let mut last_progress = Instant::now();
        loop {
            let chunk = cancellable(&mut self.cancel, async {
                response
                    .chunk()
                    .await
                    .map_err(|_| DownloadErrorCode::ReadFailed.into())
            })
            .await?;
            let Some(chunk) = chunk else {
                return self.progress.check_eof();
            };
            self.progress.add_bytes(chunk.len() as u64)?;
            // Each HTTP chunk is dropped here. No accumulation, writer, path or store.
            if last_progress.elapsed() >= PROGRESS_INTERVAL {
                emit(&self.progress);
                last_progress = Instant::now();
            }
        }
    }
}

impl Drop for Download {
    fn drop(&mut self) {
        if !self.finished {
            // Also release the reservation if the invoking task is aborted or unwinds.
            *self.active.lock().unwrap_or_else(|e| e.into_inner()) = None;
        }
    }
}

/// Resolves only at the terminal state. Listen before invoking; failures reject with
/// {code, message}. Reading events are throttled; the single terminal event is immediate.
#[tauri::command]
pub async fn tape_download_start(
    app: AppHandle,
    state: State<'_, DownloadState>,
    info_hash: Option<serde_json::Value>,
    file_idx: Option<serde_json::Value>,
    peer_port: Option<u16>,
    max_seed_ratio: Option<f64>,
) -> Result<(), DownloadError> {
    let progress = DownloadProgress::request(
        &info_hash.unwrap_or_default(),
        &file_idx.unwrap_or_default(),
    )?;
    let url = progress.url();
    let download = state.start(progress)?;
    download
        .run(
            async {
                tape_engine_ensure(app.clone(), peer_port, max_seed_ratio)
                    .await
                    .map(|_| ())
                    .map_err(|_| DownloadErrorCode::EngineUnavailable.into())
            },
            &url,
            READ_TIMEOUT,
            |progress| {
                let _ = app.emit(EVENT, progress);
            },
        )
        .await
}

#[tauri::command]
pub fn tape_download_cancel(state: State<'_, DownloadState>) {
    state.cancel();
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::{Ipv4Addr, TcpListener, TcpStream},
        thread,
    };

    fn request() -> DownloadProgress {
        DownloadProgress::request(&serde_json::json!("a".repeat(40)), &serde_json::json!(3))
            .unwrap()
    }

    fn fixture(serve: impl FnOnce(TcpStream) + Send + 'static) -> (String, thread::JoinHandle<()>) {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let task = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut headers = Vec::new();
            while !headers.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                stream.read_exact(&mut byte).unwrap();
                headers.push(byte[0]);
                assert!(headers.len() < 4096);
            }
            let headers = String::from_utf8(headers).unwrap();
            assert!(headers.starts_with(&format!("GET /{}/3 HTTP/1.1\r\n", "a".repeat(40))));
            assert!(!headers.to_ascii_lowercase().contains("\r\nrange:"));
            serve(stream);
        });
        (
            format!("http://127.0.0.1:{port}/{}/3", "a".repeat(40)),
            task,
        )
    }

    fn response(bytes: Vec<u8>) -> (Result<(), DownloadError>, Vec<DownloadProgress>) {
        let (url, server) = fixture(move |mut stream| stream.write_all(&bytes).unwrap());
        let state = DownloadState::default();
        let mut events = Vec::new();
        let result = async_runtime::block_on(state.start(request()).unwrap().run(
            async { Ok(()) },
            &url,
            READ_TIMEOUT,
            |event| events.push(event.clone()),
        ));
        server.join().unwrap();
        assert!(state.active.lock().unwrap().is_none());
        (result, events)
    }

    #[test]
    fn request_is_bounded_and_uses_only_the_fixed_tape_origin() {
        let hash = serde_json::json!("a".repeat(40));
        assert_eq!(request().url(), format!("{TAPE_URL}{}/3", "a".repeat(40)));
        for index in [serde_json::json!(0), serde_json::json!(9999)] {
            assert!(DownloadProgress::request(&hash, &index).is_ok());
        }
        for index in [
            serde_json::json!(-1),
            serde_json::json!(10000),
            serde_json::json!(1.5),
            serde_json::json!("3"),
            serde_json::Value::Null,
        ] {
            assert_eq!(
                DownloadProgress::request(&hash, &index).unwrap_err().code,
                DownloadErrorCode::InvalidRequest
            );
        }
        for hash in [
            serde_json::json!("A".repeat(40)),
            serde_json::json!("a".repeat(39)),
            serde_json::json!("g".repeat(40)),
            serde_json::json!("http://example.invalid/"),
            serde_json::json!(12),
            serde_json::Value::Null,
        ] {
            assert_eq!(
                DownloadProgress::request(&hash, &serde_json::json!(0))
                    .unwrap_err()
                    .code,
                DownloadErrorCode::InvalidRequest
            );
        }
    }

    #[test]
    fn single_active_download_is_rejected_even_when_cancellation_is_pending() {
        let state = DownloadState::default();
        let first = state.start(request()).unwrap();
        let error = state
            .start(request())
            .err()
            .expect("second active download accepted");
        assert_eq!(error.code, DownloadErrorCode::InvalidRequest);
        assert_eq!(error.message, "A tape download is already active.");
        state.cancel();
        assert!(state.start(request()).is_err());
        drop(first);
        assert!(state.start(request()).is_ok());
    }

    #[test]
    fn cancel_is_idempotent_and_start_can_be_repeated_after_termination() {
        let state = DownloadState::default();
        state.cancel();
        for _ in 0..2 {
            let download = state.start(request()).unwrap();
            state.cancel();
            state.cancel();
            let mut events = Vec::new();
            let result = async_runtime::block_on(download.run(
                std::future::pending(),
                &request().url(),
                READ_TIMEOUT,
                |event| events.push(event.clone()),
            ));
            assert_eq!(result.unwrap_err().code, DownloadErrorCode::Cancelled);
            assert_eq!(events.len(), 1);
            assert_eq!(events[0].state, DownloadStatus::Cancelled);
            assert_eq!(events[0].read_bytes, 0);
            assert!(state.active.lock().unwrap().is_none());
            state.cancel();
        }
    }

    #[test]
    fn three_byte_full_reads_complete_with_known_and_unknown_lengths() {
        for (bytes, total) in [
            (b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\nConnection: close\r\n\r\nabc".to_vec(), Some(3)),
            (b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nabc".to_vec(), None),
            (b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\na\r\n1\r\nb\r\n1\r\nc\r\n0\r\n\r\n".to_vec(), None),
        ] {
            let (result, events) = response(bytes);
            assert_eq!(result, Ok(()));
            assert_eq!(events.len(), 2, "fast reads must not flood progress events");
            assert_eq!(events[0].state, DownloadStatus::Reading);
            let last = events.last().unwrap();
            assert_eq!(last.state, DownloadStatus::Complete);
            assert_eq!(last.read_bytes, 3);
            assert_eq!(last.total_bytes, total);
        }
    }

    #[test]
    fn short_read_and_unsolicited_three_byte_range_fail() {
        for bytes in [
            b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\nConnection: close\r\n\r\nabc".to_vec(),
            b"HTTP/1.1 206 Partial Content\r\nContent-Length: 3\r\nContent-Range: bytes 0-2/10\r\n\r\nabc".to_vec(),
        ] {
            let (result, events) = response(bytes);
            assert_eq!(result.unwrap_err().code, DownloadErrorCode::ReadFailed);
            assert_eq!(events.last().unwrap().state, DownloadStatus::Failed);
            assert!(!events.iter().any(|event| event.state == DownloadStatus::Complete));
        }
        let mut progress = request();
        progress.total_bytes = Some(5);
        progress.add_bytes(3).unwrap();
        assert_eq!(
            progress.check_eof().unwrap_err().code,
            DownloadErrorCode::ReadFailed
        );
    }

    #[test]
    fn size_ceiling_rejects_declared_and_unannounced_excess() {
        assert_eq!(MAX_BYTES, 17_179_869_184);
        assert!(check_size(MAX_BYTES).is_ok());
        let (result, events) = response(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                MAX_BYTES + 1
            )
            .into_bytes(),
        );
        assert_eq!(result.unwrap_err().code, DownloadErrorCode::TooLarge);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].read_bytes, 0);
        let mut progress = request();
        progress.read_bytes = MAX_BYTES - 1;
        progress.add_bytes(1).unwrap();
        assert_eq!(
            progress.add_bytes(1).unwrap_err().code,
            DownloadErrorCode::TooLarge
        );
        assert_eq!(progress.read_bytes, MAX_BYTES);
    }

    #[test]
    fn cancel_mid_read_drops_the_socket_promptly_and_emits_once() {
        let (url, server) = fixture(|mut stream| {
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n")
                .unwrap();
            thread::sleep(PROGRESS_INTERVAL + Duration::from_millis(50));
            stream.write_all(b"a").unwrap();
            // No EOF and no more bytes: cancel must close the live reader, not wait
            // for the 120-second read timeout or issue a torrent removal request.
            let mut byte = [0];
            assert_eq!(stream.read(&mut byte).unwrap(), 0);
        });
        let state = DownloadState::default();
        let mut events = Vec::new();
        let mut cancelled_at = None;
        let result = async_runtime::block_on(state.start(request()).unwrap().run(
            async { Ok(()) },
            &url,
            READ_TIMEOUT,
            |event| {
                events.push(event.clone());
                if event.state == DownloadStatus::Reading && event.read_bytes == 1 {
                    cancelled_at = Some(Instant::now());
                    state.cancel();
                    state.cancel();
                }
            },
        ));
        server.join().unwrap();
        assert!(cancelled_at.unwrap().elapsed() < Duration::from_secs(2));
        assert_eq!(result.unwrap_err().code, DownloadErrorCode::Cancelled);
        assert_eq!(
            events
                .iter()
                .filter(|event| event.state != DownloadStatus::Reading)
                .count(),
            1
        );
        assert_eq!(events.last().unwrap().state, DownloadStatus::Cancelled);
        assert_eq!(events.last().unwrap().read_bytes, 1);
        assert_eq!(events.last().unwrap().total_bytes, Some(3));
        assert!(state.start(request()).is_ok());
    }

    #[test]
    fn cancel_wakes_a_pending_request_before_response_headers() {
        let state = Arc::new(DownloadState::default());
        let (ready_tx, ready_rx) = std::sync::mpsc::channel();
        let (url, server) = fixture(move |mut stream| {
            ready_tx.send(()).unwrap();
            let mut byte = [0];
            assert_eq!(stream.read(&mut byte).unwrap(), 0);
        });
        let cancel_state = state.clone();
        let canceller = thread::spawn(move || {
            ready_rx.recv_timeout(Duration::from_secs(3)).unwrap();
            thread::sleep(Duration::from_millis(50));
            let started = Instant::now();
            cancel_state.cancel();
            cancel_state.cancel();
            started
        });
        let mut events = Vec::new();
        let result = async_runtime::block_on(state.start(request()).unwrap().run(
            async { Ok(()) },
            &url,
            READ_TIMEOUT,
            |event| events.push(event.clone()),
        ));
        server.join().unwrap();
        assert!(canceller.join().unwrap().elapsed() < Duration::from_secs(2));
        assert_eq!(result.unwrap_err().code, DownloadErrorCode::Cancelled);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].state, DownloadStatus::Cancelled);
        assert!(state.start(request()).is_ok());
    }

    #[test]
    fn idle_read_timeout_is_failed_and_releases_the_slot() {
        let (url, server) = fixture(|mut stream| {
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 3\r\n\r\n")
                .unwrap();
            let mut byte = [0];
            assert_eq!(stream.read(&mut byte).unwrap(), 0);
        });
        let state = DownloadState::default();
        let mut events = Vec::new();
        let result = async_runtime::block_on(state.start(request()).unwrap().run(
            async { Ok(()) },
            &url,
            Duration::from_millis(50),
            |event| events.push(event.clone()),
        ));
        server.join().unwrap();
        assert_eq!(result.unwrap_err().code, DownloadErrorCode::ReadFailed);
        assert_eq!(events.last().unwrap().state, DownloadStatus::Failed);
        assert!(state.start(request()).is_ok());
    }

    #[test]
    fn errors_are_closed_and_engine_failures_never_open_a_read() {
        for (code, label) in [
            (DownloadErrorCode::EngineUnavailable, "engine-unavailable"),
            (DownloadErrorCode::TorrentNotFound, "torrent-not-found"),
            (DownloadErrorCode::InvalidRequest, "invalid-request"),
            (DownloadErrorCode::ReadFailed, "read-failed"),
            (DownloadErrorCode::TooLarge, "too-large"),
            (DownloadErrorCode::Cancelled, "cancelled"),
        ] {
            let value = serde_json::to_value(DownloadError::from(code)).unwrap();
            assert_eq!(value["code"], label);
            assert_eq!(value.as_object().unwrap().len(), 2);
            assert!(value["message"].as_str().unwrap().len() < 80);
            assert!(!value.to_string().contains("://"));
        }
        let state = DownloadState::default();
        let mut events = Vec::new();
        let result = async_runtime::block_on(state.start(request()).unwrap().run(
            async { Err(DownloadErrorCode::EngineUnavailable.into()) },
            "invalid transport must never be used",
            READ_TIMEOUT,
            |event| events.push(event.clone()),
        ));
        assert_eq!(
            result.unwrap_err().code,
            DownloadErrorCode::EngineUnavailable
        );
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].state, DownloadStatus::Failed);
        for (status, code) in [
            (404, DownloadErrorCode::TorrentNotFound),
            (503, DownloadErrorCode::EngineUnavailable),
            (500, DownloadErrorCode::ReadFailed),
            (302, DownloadErrorCode::ReadFailed),
        ] {
            let (result, _) = response(format!("HTTP/1.1 {status} Fixture\r\nContent-Length: 0\r\nLocation: http://example.invalid/\r\n\r\n").into_bytes());
            assert_eq!(result.unwrap_err().code, code);
        }
    }

    #[test]
    fn progress_payload_has_only_bounded_typed_fields_and_never_a_url() {
        for status in [
            DownloadStatus::Reading,
            DownloadStatus::Complete,
            DownloadStatus::Cancelled,
            DownloadStatus::Failed,
        ] {
            let mut progress = request();
            progress.state = status;
            let value = serde_json::to_value(progress).unwrap();
            let keys: Vec<_> = value
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect();
            assert_eq!(
                keys,
                ["fileIdx", "infoHash", "readBytes", "state", "totalBytes"]
            );
            assert_eq!(value["infoHash"], "a".repeat(40));
            assert_eq!(value["fileIdx"], 3);
            assert_eq!(value["readBytes"], 0);
            assert!(value["totalBytes"].is_null());
            let encoded = value.to_string();
            assert!(!encoded.contains("://"));
            assert!(!encoded.contains("127.0.0.1"));
            assert!(encoded.len() < 180);
        }
    }
}
