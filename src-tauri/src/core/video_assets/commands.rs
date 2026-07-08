use super::models::{SaveVideoAssetRequest, VideoAssetRecord};
use crate::core::app::commands::get_mita_data_folder_path;
use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use futures_util::StreamExt;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tauri::Runtime;

const VIDEO_ASSETS_DIR: &str = "video-assets";
const REMOTE_VIDEO_DOWNLOAD_TIMEOUT_SECS: u64 = 120;
const MAX_REMOTE_VIDEO_BYTES: u64 = 512 * 1024 * 1024;
const MAX_REMOTE_ERROR_BODY_BYTES: u64 = 16 * 1024;

fn validate_asset_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("Invalid video asset id".to_string());
    }
    Ok(())
}

fn normalize_extension(value: Option<&str>, mime_type: &str) -> String {
    let raw = value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            if mime_type.contains("quicktime") {
                "mov"
            } else if mime_type.contains("webm") {
                "webm"
            } else {
                "mp4"
            }
        });

    match raw.trim_start_matches('.').to_ascii_lowercase().as_str() {
        "mov" => "mov".to_string(),
        "webm" => "webm".to_string(),
        _ => "mp4".to_string(),
    }
}

fn strip_data_url(input: &str) -> &str {
    input
        .split_once(";base64,")
        .map(|(_, data)| data)
        .unwrap_or(input)
}

fn assets_root<R: Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    get_mita_data_folder_path(app.clone()).join(VIDEO_ASSETS_DIR)
}

fn metadata_path(asset_dir: &Path) -> PathBuf {
    asset_dir.join("metadata.json")
}

fn write_metadata(path: &Path, record: &VideoAssetRecord) -> Result<(), String> {
    let tmp_path = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_video_asset<R: Runtime>(
    app: tauri::AppHandle<R>,
    asset: SaveVideoAssetRequest,
) -> Result<VideoAssetRecord, String> {
    let b64_json = asset
        .b64_json
        .as_deref()
        .ok_or_else(|| "Missing video base64".to_string())?;
    let video_bytes = general_purpose::STANDARD
        .decode(strip_data_url(b64_json))
        .map_err(|e| format!("Invalid video base64: {e}"))?;

    save_video_asset_bytes(app, asset, video_bytes)
}

#[tauri::command]
pub async fn save_video_asset_from_url<R: Runtime>(
    app: tauri::AppHandle<R>,
    mut asset: SaveVideoAssetRequest,
) -> Result<VideoAssetRecord, String> {
    let video_url = asset
        .video_url
        .as_deref()
        .ok_or_else(|| "Missing generated video URL".to_string())?
        .to_string();
    let (video_bytes, mime_type) = download_video_asset(&video_url).await?;
    asset.mime_type = mime_type;
    asset.extension = None;

    save_video_asset_bytes(app, asset, video_bytes)
}

fn save_video_asset_bytes<R: Runtime>(
    app: tauri::AppHandle<R>,
    asset: SaveVideoAssetRequest,
    video_bytes: Vec<u8>,
) -> Result<VideoAssetRecord, String> {
    validate_asset_id(&asset.id)?;

    let root = assets_root(&app);
    let asset_dir = root.join(&asset.id);
    fs::create_dir_all(&asset_dir).map_err(|e| e.to_string())?;

    let extension = normalize_extension(asset.extension.as_deref(), &asset.mime_type);
    let file_name = format!("video.{extension}");
    let video_path = asset_dir.join(&file_name);

    fs::write(&video_path, video_bytes).map_err(|e| e.to_string())?;

    let record = VideoAssetRecord {
        id: asset.id,
        prompt: asset.prompt,
        provider: asset.provider,
        model: asset.model,
        ratio: asset.ratio,
        resolution: asset.resolution,
        duration: asset.duration,
        fps: asset.fps,
        source_asset_ids: asset.source_asset_ids,
        created_at: asset.created_at.unwrap_or_else(|| Utc::now().to_rfc3339()),
        usage: asset.usage,
        status: asset.status,
        path: video_path.to_string_lossy().to_string(),
        file_name,
        mime_type: asset.mime_type,
        asset_kind: asset.asset_kind.or_else(|| Some("generated".to_string())),
    };

    write_metadata(&metadata_path(&asset_dir), &record)?;
    Ok(record)
}

async fn download_video_asset(video_url: &str) -> Result<(Vec<u8>, String), String> {
    let response = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(10))
        .timeout(Duration::from_secs(REMOTE_VIDEO_DOWNLOAD_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?
        .get(video_url)
        .send()
        .await
        .map_err(|e| format!("Unable to download generated video: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let detail = read_response_body_limited(response, MAX_REMOTE_ERROR_BODY_BYTES)
            .await
            .map(|bytes| String::from_utf8_lossy(&bytes).to_string())
            .unwrap_or_default();
        let detail = detail.chars().take(300).collect::<String>();
        return Err(if detail.is_empty() {
            format!("Unable to download generated video ({status})")
        } else {
            format!("Unable to download generated video ({status}): {detail}")
        });
    }

    if let Some(content_length) = response.content_length() {
        if content_length > MAX_REMOTE_VIDEO_BYTES {
            return Err(format!(
                "Generated video is too large ({content_length} bytes)"
            ));
        }
    }

    let mime_type = response_video_mime_type(&response, video_url)?;
    let video_bytes = read_response_body_limited(response, MAX_REMOTE_VIDEO_BYTES).await?;

    Ok((video_bytes, mime_type))
}

fn response_video_mime_type(
    response: &reqwest::Response,
    video_url: &str,
) -> Result<String, String> {
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty());

    match content_type.as_deref() {
        Some(value) if value.starts_with("video/") => Ok(value.to_string()),
        Some("application/octet-stream") | None => {
            video_mime_from_url(video_url).ok_or_else(|| {
                "Generated video response is missing a supported video content type".to_string()
            })
        }
        Some(value) => Err(format!(
            "Generated video response has unsupported content type: {value}"
        )),
    }
}

fn video_mime_from_url(video_url: &str) -> Option<String> {
    let path = url::Url::parse(video_url)
        .ok()
        .map(|url| url.path().to_ascii_lowercase())?;

    if path.ends_with(".webm") {
        Some("video/webm".to_string())
    } else if path.ends_with(".mov") {
        Some("video/quicktime".to_string())
    } else if path.ends_with(".mp4") || path.ends_with(".m4v") {
        Some("video/mp4".to_string())
    } else {
        None
    }
}

async fn read_response_body_limited(
    response: reqwest::Response,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    let mut stream = response.bytes_stream();
    let mut body = Vec::new();
    let mut total = 0_u64;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Unable to read generated video body: {e}"))?;
        total = total
            .checked_add(chunk.len() as u64)
            .ok_or_else(|| "Generated video body is too large".to_string())?;
        if total > max_bytes {
            return Err(format!("Generated video exceeds {max_bytes} bytes"));
        }
        body.extend_from_slice(&chunk);
    }

    Ok(body)
}

#[tauri::command]
pub fn list_video_assets<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<VideoAssetRecord>, String> {
    let root = assets_root(&app);
    if !root.exists() {
        return Ok(Vec::new());
    }

    let mut assets = Vec::new();
    for entry in fs::read_dir(&root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let metadata = metadata_path(&path);
        if !metadata.exists() {
            continue;
        }

        let data = fs::read_to_string(&metadata).map_err(|e| e.to_string())?;
        if let Ok(record) = serde_json::from_str::<VideoAssetRecord>(&data) {
            assets.push(record);
        }
    }

    assets.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(assets)
}

#[tauri::command]
pub fn delete_video_asset<R: Runtime>(
    app: tauri::AppHandle<R>,
    asset_id: String,
) -> Result<(), String> {
    validate_asset_id(&asset_id)?;
    let path = assets_root(&app).join(asset_id);
    if !path.exists() {
        return Ok(());
    }
    fs::remove_dir_all(path).map_err(|e| e.to_string())
}
