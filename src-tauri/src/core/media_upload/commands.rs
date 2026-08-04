use super::models::{
    MediaUploadError, UploadVideoReferenceMediaRequest, UploadedVideoReferenceMedia,
};
use futures_util::StreamExt;
use reqwest::{
    header::{HeaderName, HeaderValue},
    multipart::{Form, Part},
    Body, StatusCode,
};
use serde::Deserialize;
use std::{io::SeekFrom, path::Path, str::FromStr, time::Duration};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;

const IMAGE_LIMIT_BYTES: u64 = 30 * 1024 * 1024;
const AUDIO_LIMIT_BYTES: u64 = 15 * 1024 * 1024;
const VIDEO_LIMIT_BYTES: u64 = 200 * 1024 * 1024;
const MAX_RESPONSE_BYTES: u64 = 64 * 1024;
const UPLOAD_TIMEOUT_SECS: u64 = 10 * 60;
const CONNECT_TIMEOUT_SECS: u64 = 30;
const STREAM_BUFFER_BYTES: usize = 64 * 1024;
const MAX_CUSTOM_HEADERS: usize = 32;
const MAX_CUSTOM_HEADER_NAME_BYTES: usize = 128;
const MAX_CUSTOM_HEADER_VALUE_BYTES: usize = 8 * 1024;
const BIYUAN_MEDIA_HOSTS: &[&str] = &[
    "api.biyuan.ai",
    "api.jingxing.io",
    "api.jingxing.uk",
    "jingxing.io",
];

#[derive(Debug, Deserialize)]
struct RawUploadedMedia {
    id: String,
    kind: String,
    mime_type: String,
    size_bytes: u64,
    expires_at: String,
}

#[tauri::command]
pub async fn upload_video_reference_media(
    request: UploadVideoReferenceMediaRequest,
) -> Result<UploadedVideoReferenceMedia, MediaUploadError> {
    let endpoint = validate_endpoint(&request.endpoint)?;
    let api_key = request
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            MediaUploadError::new(
                "missing_api_key",
                None,
                "A Biyuan API key is required to upload reference media",
            )
        })?;
    let kind = request.reference.kind.trim().to_ascii_lowercase();
    let declared_mime_type = normalize_mime_type(&request.reference.asset.mime_type);
    let mut file = tokio::fs::File::open(&request.reference.asset.path)
        .await
        .map_err(|error| {
            MediaUploadError::new(
                "file_unavailable",
                None,
                format!("Unable to open reference media: {error}"),
            )
        })?;
    let metadata = file.metadata().await.map_err(|error| {
        MediaUploadError::new(
            "file_unavailable",
            None,
            format!("Unable to inspect reference media: {error}"),
        )
    })?;
    if !metadata.is_file() {
        return Err(MediaUploadError::new(
            "invalid_media_file",
            None,
            "Reference media must be a regular file",
        ));
    }
    let size_bytes = metadata.len();
    validate_media(&kind, &declared_mime_type, size_bytes)?;

    let mut header = [0_u8; 512];
    let header_bytes = file.read(&mut header).await.map_err(|error| {
        MediaUploadError::new(
            "file_unavailable",
            None,
            format!("Unable to inspect reference media: {error}"),
        )
    })?;
    file.seek(SeekFrom::Start(0)).await.map_err(|error| {
        MediaUploadError::new(
            "file_unavailable",
            None,
            format!("Unable to inspect reference media: {error}"),
        )
    })?;
    let (mime_type, extension) = detect_media_format(
        &kind,
        Path::new(&request.reference.asset.path),
        &header[..header_bytes],
    )?;
    if mime_type != declared_mime_type {
        return Err(MediaUploadError::new(
            "unsupported_media_format",
            None,
            "Reference media type does not match its file contents",
        ));
    }

    let file_name = format!("upload.{extension}");
    let body = Body::wrap_stream(ReaderStream::with_capacity(
        file.take(size_bytes),
        STREAM_BUFFER_BYTES,
    ));
    let part = Part::stream_with_length(body, size_bytes)
        .file_name(file_name)
        .mime_str(&mime_type)
        .map_err(|error| {
            MediaUploadError::new(
                "invalid_media_type",
                None,
                format!("Invalid reference media type: {error}"),
            )
        })?;
    let form = Form::new().text("kind", kind.clone()).part("file", part);

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(UPLOAD_TIMEOUT_SECS))
        .build()
        .map_err(|error| {
            MediaUploadError::new(
                "client_error",
                None,
                format!("Unable to prepare media upload: {error}"),
            )
        })?;
    if request.custom_headers.len() > MAX_CUSTOM_HEADERS {
        return Err(MediaUploadError::new(
            "invalid_header",
            None,
            "Too many custom media upload headers",
        ));
    }
    let mut upload = client.post(endpoint).multipart(form);
    for (name, value) in request.custom_headers {
        if is_protected_header(&name) {
            continue;
        }
        if name.len() > MAX_CUSTOM_HEADER_NAME_BYTES || value.len() > MAX_CUSTOM_HEADER_VALUE_BYTES
        {
            return Err(MediaUploadError::new(
                "invalid_header",
                None,
                "Custom media upload header is too large",
            ));
        }
        let name = HeaderName::from_str(name.trim()).map_err(|error| {
            MediaUploadError::new(
                "invalid_header",
                None,
                format!("Invalid custom upload header: {error}"),
            )
        })?;
        let value = HeaderValue::from_str(&value).map_err(|error| {
            MediaUploadError::new(
                "invalid_header",
                None,
                format!("Invalid custom upload header value: {error}"),
            )
        })?;
        upload = upload.header(name, value);
    }
    let response = upload
        .bearer_auth(api_key)
        .header("x-api-key", api_key)
        .send()
        .await
        .map_err(|error| {
            MediaUploadError::new(
                "media_upload_outcome_unknown",
                None,
                format!("Unable to upload reference media: {error}"),
            )
            .outcome_unknown()
        })?;
    let status = response.status();
    let retry_after_seconds = response
        .headers()
        .get(reqwest::header::RETRY_AFTER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.trim().parse::<u64>().ok());
    let request_id = ["x-request-id", "request-id", "x-ms-request-id"]
        .iter()
        .find_map(|name| {
            response
                .headers()
                .get(*name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_string)
        });
    let response_body = read_response_limited(response).await?;

    if !status.is_success() {
        let mut error = http_error(status, &response_body);
        error.retry_after_seconds = retry_after_seconds;
        error.request_id = request_id;
        return Err(error);
    }

    let uploaded: RawUploadedMedia = serde_json::from_slice(&response_body).map_err(|error| {
        MediaUploadError::new(
            "media_upload_outcome_unknown",
            Some(status.as_u16()),
            format!("Biyuan returned an invalid media upload response: {error}"),
        )
        .outcome_unknown()
    })?;
    if uploaded.id.trim().is_empty()
        || uploaded.id.chars().any(char::is_control)
        || uploaded.kind != kind
        || uploaded.size_bytes != size_bytes
        || normalize_mime_type(&uploaded.mime_type) != mime_type
        || uploaded.expires_at.trim().is_empty()
    {
        return Err(MediaUploadError::new(
            "media_upload_outcome_unknown",
            Some(status.as_u16()),
            "Biyuan returned inconsistent media upload metadata",
        )
        .outcome_unknown());
    }
    let expires_at = chrono::DateTime::parse_from_rfc3339(&uploaded.expires_at)
        .map_err(|_| {
            MediaUploadError::new(
                "media_upload_outcome_unknown",
                Some(status.as_u16()),
                "Biyuan returned an invalid media expiration time",
            )
            .outcome_unknown()
        })?
        .with_timezone(&chrono::Utc);
    if expires_at <= chrono::Utc::now() {
        return Err(MediaUploadError::new(
            "media_upload_outcome_unknown",
            Some(status.as_u16()),
            "Biyuan returned an expired media reference",
        )
        .outcome_unknown());
    }

    Ok(UploadedVideoReferenceMedia {
        id: uploaded.id,
        kind: uploaded.kind,
        mime_type: uploaded.mime_type,
        size_bytes: uploaded.size_bytes,
        expires_at: uploaded.expires_at,
    })
}

pub(super) fn validate_endpoint(value: &str) -> Result<reqwest::Url, MediaUploadError> {
    let endpoint = reqwest::Url::parse(value.trim()).map_err(|_| {
        MediaUploadError::new(
            "invalid_endpoint",
            None,
            "Biyuan media upload endpoint is invalid",
        )
    })?;
    let allowed_host = endpoint
        .host_str()
        .map(|host| {
            BIYUAN_MEDIA_HOSTS
                .iter()
                .any(|allowed| host.eq_ignore_ascii_case(allowed))
        })
        .unwrap_or(false);
    if endpoint.scheme() != "https"
        || !endpoint.username().is_empty()
        || endpoint.password().is_some()
        || endpoint.port_or_known_default() != Some(443)
        || !allowed_host
        || endpoint.path() != "/v1/media"
        || endpoint.query().is_some()
        || endpoint.fragment().is_some()
    {
        return Err(MediaUploadError::new(
            "invalid_endpoint",
            None,
            "Biyuan media upload endpoint is not an approved HTTPS endpoint",
        ));
    }
    Ok(endpoint)
}

pub(super) fn validate_media(
    kind: &str,
    mime_type: &str,
    size_bytes: u64,
) -> Result<(), MediaUploadError> {
    if size_bytes == 0 {
        return Err(MediaUploadError::new(
            "empty_file",
            None,
            "Reference media must not be empty",
        ));
    }

    let (supported, within_limit) = match kind {
        "image" => (
            matches!(mime_type, "image/jpeg" | "image/png"),
            size_bytes < IMAGE_LIMIT_BYTES,
        ),
        "audio" => (
            matches!(mime_type, "audio/mpeg" | "audio/wav" | "audio/x-wav"),
            size_bytes <= AUDIO_LIMIT_BYTES,
        ),
        "video" => (
            matches!(mime_type, "video/mp4" | "video/quicktime"),
            size_bytes <= VIDEO_LIMIT_BYTES,
        ),
        _ => {
            return Err(MediaUploadError::new(
                "invalid_kind",
                None,
                "Reference media kind must be image, video, or audio",
            ))
        }
    };
    if !supported {
        return Err(MediaUploadError::new(
            "unsupported_media_type",
            None,
            format!("Unsupported {kind} reference media type: {mime_type}"),
        ));
    }
    if !within_limit {
        return Err(MediaUploadError::new(
            "file_too_large",
            Some(StatusCode::PAYLOAD_TOO_LARGE.as_u16()),
            format!("The {kind} reference exceeds the Biyuan upload limit"),
        ));
    }
    Ok(())
}

pub(super) fn detect_media_format(
    kind: &str,
    path: &Path,
    header: &[u8],
) -> Result<(String, &'static str), MediaUploadError> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    let matches_magic = match (kind, extension.as_str()) {
        ("image", "png") => {
            header.len() >= 8 && header[..8] == [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n']
        }
        ("image", "jpg" | "jpeg") => {
            header.len() >= 3 && header[0] == 0xff && header[1] == 0xd8 && header[2] == 0xff
        }
        ("audio", "mp3") => {
            (header.len() >= 3 && &header[..3] == b"ID3")
                || (header.len() >= 2 && header[0] == 0xff && header[1] & 0xe0 == 0xe0)
        }
        ("audio", "wav") => {
            header.len() >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WAVE"
        }
        ("video", "mp4") => has_leading_media_box(header, &[b"ftyp"]),
        ("video", "mov") => has_leading_media_box(header, &[b"ftyp", b"moov"]),
        _ => false,
    };
    if !matches_magic {
        return Err(MediaUploadError::new(
            "unsupported_media_format",
            None,
            "Reference media extension or contents are not supported by Biyuan",
        ));
    }

    let (mime_type, safe_extension) = match (kind, extension.as_str()) {
        ("image", "png") => ("image/png", "png"),
        ("image", "jpg" | "jpeg") => ("image/jpeg", "jpg"),
        ("audio", "mp3") => ("audio/mpeg", "mp3"),
        ("audio", "wav") => ("audio/wav", "wav"),
        ("video", "mp4") => ("video/mp4", "mp4"),
        ("video", "mov") => ("video/quicktime", "mov"),
        _ => unreachable!("magic validation only accepts supported media"),
    };
    Ok((mime_type.to_string(), safe_extension))
}

fn has_leading_media_box(header: &[u8], allowed_types: &[&[u8; 4]]) -> bool {
    if header.len() < 8 {
        return false;
    }
    let declared_size = u32::from_be_bytes([header[0], header[1], header[2], header[3]]) as u64;
    let (box_type_offset, minimum_size, effective_size) = if declared_size == 1 {
        if header.len() < 16 {
            return false;
        }
        let extended_size = u64::from_be_bytes([
            header[8], header[9], header[10], header[11], header[12], header[13], header[14],
            header[15],
        ]);
        if extended_size < 16 {
            return false;
        }
        (4, 16, extended_size)
    } else {
        (4, 8, declared_size)
    };
    if effective_size != 0 && effective_size < minimum_size {
        return false;
    }
    let box_type = &header[box_type_offset..box_type_offset + 4];
    allowed_types
        .iter()
        .any(|allowed| box_type == allowed.as_slice())
}

fn normalize_mime_type(value: &str) -> String {
    match value.trim().to_ascii_lowercase().as_str() {
        "image/jpg" => "image/jpeg".to_string(),
        "audio/x-wav" => "audio/wav".to_string(),
        value => value.to_string(),
    }
}

fn is_protected_header(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "authorization"
            | "connection"
            | "content-length"
            | "content-type"
            | "cookie"
            | "expect"
            | "host"
            | "proxy-authorization"
            | "transfer-encoding"
            | "upgrade"
            | "x-api-key"
    )
}

async fn read_response_limited(response: reqwest::Response) -> Result<Vec<u8>, MediaUploadError> {
    let status = response.status();
    if response.content_length().unwrap_or(0) > MAX_RESPONSE_BYTES {
        let error = MediaUploadError::new(
            "response_too_large",
            Some(status.as_u16()),
            "Biyuan media upload response is too large",
        );
        return Err(if status.is_success() {
            error.outcome_unknown()
        } else {
            error
        });
    }
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| {
            let upload_error = MediaUploadError::new(
                "network_error",
                Some(status.as_u16()),
                format!("Unable to read media upload response: {error}"),
            );
            if status.is_success() {
                upload_error.outcome_unknown()
            } else {
                upload_error
            }
        })?;
        if body.len() as u64 + chunk.len() as u64 > MAX_RESPONSE_BYTES {
            let error = MediaUploadError::new(
                "response_too_large",
                Some(status.as_u16()),
                "Biyuan media upload response is too large",
            );
            return Err(if status.is_success() {
                error.outcome_unknown()
            } else {
                error
            });
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn http_error(status: StatusCode, body: &[u8]) -> MediaUploadError {
    let server_message = serde_json::from_slice::<serde_json::Value>(body)
        .ok()
        .and_then(|value| {
            value
                .pointer("/error/message")
                .or_else(|| value.get("message"))
                .and_then(|message| message.as_str())
                .map(|message| message.chars().take(500).collect::<String>())
        });
    let (code, fallback) = match status {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => (
            "authentication_failed",
            "Biyuan rejected the API key used for the media upload",
        ),
        StatusCode::PAYLOAD_TOO_LARGE => (
            "file_too_large",
            "The reference media exceeds the Biyuan upload limit",
        ),
        StatusCode::TOO_MANY_REQUESTS => (
            "rate_limited",
            "Biyuan media upload is rate limited or the daily budget is exhausted",
        ),
        StatusCode::SERVICE_UNAVAILABLE => (
            "service_unavailable",
            "Biyuan media upload is temporarily unavailable",
        ),
        _ => ("upload_failed", "Biyuan rejected the media upload"),
    };
    MediaUploadError::new(
        code,
        Some(status.as_u16()),
        server_message.unwrap_or_else(|| fallback.to_string()),
    )
}
