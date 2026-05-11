use super::models::{ImageAssetRecord, SaveImageAssetRequest};
use crate::core::app::commands::get_mita_data_folder_path;
use base64::{engine::general_purpose, Engine as _};
use chrono::Utc;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::Runtime;

const IMAGE_ASSETS_DIR: &str = "image-assets";

fn validate_asset_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("Invalid image asset id".to_string());
    }
    Ok(())
}

fn normalize_extension(value: Option<&str>, mime_type: &str) -> String {
    let raw = value
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .unwrap_or_else(|| {
            if mime_type.contains("jpeg") || mime_type.contains("jpg") {
                "jpg"
            } else if mime_type.contains("webp") {
                "webp"
            } else {
                "png"
            }
        });

    let normalized = raw.trim_start_matches('.').to_ascii_lowercase();
    match normalized.as_str() {
        "jpg" | "jpeg" => "jpg".to_string(),
        "webp" => "webp".to_string(),
        _ => "png".to_string(),
    }
}

fn strip_data_url(input: &str) -> &str {
    input
        .split_once(";base64,")
        .map(|(_, data)| data)
        .unwrap_or(input)
}

fn assets_root<R: Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    get_mita_data_folder_path(app.clone()).join(IMAGE_ASSETS_DIR)
}

fn metadata_path(asset_dir: &Path) -> PathBuf {
    asset_dir.join("metadata.json")
}

fn write_metadata(path: &Path, record: &ImageAssetRecord) -> Result<(), String> {
    let tmp_path = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(record).map_err(|e| e.to_string())?;
    fs::write(&tmp_path, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp_path, path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_image_asset<R: Runtime>(
    app: tauri::AppHandle<R>,
    asset: SaveImageAssetRequest,
) -> Result<ImageAssetRecord, String> {
    validate_asset_id(&asset.id)?;

    let root = assets_root(&app);
    let asset_dir = root.join(&asset.id);
    fs::create_dir_all(&asset_dir).map_err(|e| e.to_string())?;

    let extension = normalize_extension(asset.extension.as_deref(), &asset.mime_type);
    let file_name = format!("image.{extension}");
    let image_path = asset_dir.join(&file_name);
    let image_bytes = general_purpose::STANDARD
        .decode(strip_data_url(&asset.b64_json))
        .map_err(|e| format!("Invalid image base64: {e}"))?;

    fs::write(&image_path, image_bytes).map_err(|e| e.to_string())?;

    let record = ImageAssetRecord {
        id: asset.id,
        prompt: asset.prompt,
        mode: asset.mode,
        provider: asset.provider,
        model: asset.model,
        ratio: asset.ratio,
        size: asset.size,
        quality: asset.quality,
        source_asset_ids: asset.source_asset_ids,
        created_at: asset.created_at.unwrap_or_else(|| Utc::now().to_rfc3339()),
        usage: asset.usage,
        revised_prompt: asset.revised_prompt,
        status: asset.status,
        path: image_path.to_string_lossy().to_string(),
        file_name,
        mime_type: asset.mime_type,
    };

    write_metadata(&metadata_path(&asset_dir), &record)?;
    Ok(record)
}

#[tauri::command]
pub fn list_image_assets<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<ImageAssetRecord>, String> {
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
        if let Ok(record) = serde_json::from_str::<ImageAssetRecord>(&data) {
            assets.push(record);
        }
    }

    assets.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(assets)
}

#[tauri::command]
pub fn delete_image_asset<R: Runtime>(
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
