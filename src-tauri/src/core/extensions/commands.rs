use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Runtime};

use crate::core::app::commands::get_biyan_data_folder_path;
use crate::core::setup::{self, is_allowed_bundled_extension_id};

#[tauri::command]
pub fn get_biyan_extensions_path<R: Runtime>(app_handle: tauri::AppHandle<R>) -> PathBuf {
    get_biyan_data_folder_path(app_handle).join("extensions")
}

#[tauri::command]
pub fn install_extensions<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    setup::install_extensions(app, true)
}

#[tauri::command]
pub fn get_active_extensions<R: Runtime>(app: AppHandle<R>) -> Vec<serde_json::Value> {
    // On mobile platforms, extensions are pre-bundled in the frontend
    // Return empty array so frontend's MobileCoreService handles it
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        return vec![];
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let mut path = get_biyan_extensions_path(app);
        path.push("extensions.json");
        log::info!("get Biyan extensions, path: {path:?}");

        let contents = fs::read_to_string(path);
        let contents: Vec<serde_json::Value> = match contents {
            Ok(data) => match serde_json::from_str::<Vec<serde_json::Value>>(&data) {
                Ok(exts) => exts
                    .into_iter()
                    .filter(|ext| {
                        let Some(name) = ext.get("name").and_then(|value| value.as_str()) else {
                            return false;
                        };
                        let active = ext
                            .get("active")
                            .or_else(|| ext.get("_active"))
                            .and_then(|value| value.as_bool())
                            .unwrap_or(true);
                        active && is_allowed_bundled_extension_id(name)
                    })
                    .map(|ext| {
                        // Check for "active" first, then "_active" (legacy), default to true
                        let active = ext
                            .get("active")
                            .or_else(|| ext.get("_active"))
                            .unwrap_or(&serde_json::json!(true))
                            .clone();
                        serde_json::json!({
                            "url": ext["url"],
                            "name": ext["name"],
                            "productName": ext["productName"],
                            "active": active,
                            "description": ext["description"],
                            "version": ext["version"]
                        })
                    })
                    .collect(),
                Err(error) => {
                    log::error!("Failed to parse extensions.json: {error}");
                    vec![]
                }
            },
            Err(error) => {
                log::error!("Failed to read extensions.json: {error}");
                vec![]
            }
        };
        contents
    }
}
