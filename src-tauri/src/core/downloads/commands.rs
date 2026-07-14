use super::helpers::{_download_files_internal, err_to_string, is_retired_download_url};
use super::models::DownloadItem;
use crate::core::app::commands::get_biyan_data_folder_path;
use crate::core::filesystem::helpers::resolve_path_within_biyan_data_folder;
use crate::core::state::AppState;
use std::collections::HashMap;
use tauri::{Runtime, State};
use tokio_util::sync::CancellationToken;

const RETIRED_MODEL_EXTENSIONS: &[&str] =
    &["gguf", "safetensors", "ckpt", "pth", "onnx", "mlmodel"];

pub(super) fn reject_retired_model_download(item: &DownloadItem) -> Result<(), String> {
    let save_path = item.save_path.replace('\\', "/").to_ascii_lowercase();
    let has_retired_directory = save_path.split('/').any(|component| {
        matches!(
            component,
            "llamacpp" | "mlx" | "models" | "hub" | "rag" | "vector-db" | "embedding-models"
        )
    });
    let has_model_extension = save_path
        .rsplit('.')
        .next()
        .is_some_and(|ext| RETIRED_MODEL_EXTENSIONS.contains(&ext));

    let parsed_url = url::Url::parse(&item.url).map_err(|_| "download_invalid_url".to_string())?;
    if has_retired_directory || has_model_extension || is_retired_download_url(&parsed_url) {
        return Err(
            "LOCAL_RUNTIME_REMOVED: model and embedding downloads are no longer supported"
                .to_string(),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn download_files<R: Runtime>(
    app: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    items: Vec<DownloadItem>,
    task_id: &str,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    for item in &items {
        reject_retired_model_download(item)?;
    }

    // insert cancel tokens
    let cancel_token = CancellationToken::new();
    {
        let mut download_manager = state.download_manager.lock().await;
        if let Some(existing_token) = download_manager.cancel_tokens.remove(task_id) {
            log::info!("Cancelling existing download task: {task_id}");
            existing_token.cancel();
        }
        download_manager
            .cancel_tokens
            .insert(task_id.to_string(), cancel_token.clone());
    }
    // TODO: Support resuming downloads when FE is ready
    let result = _download_files_internal(
        app.clone(),
        &items,
        &headers,
        task_id,
        false,
        cancel_token.clone(),
    )
    .await;

    // cleanup
    {
        let mut download_manager = state.download_manager.lock().await;
        download_manager.cancel_tokens.remove(task_id);
    }

    // delete files if cancelled
    if cancel_token.is_cancelled() {
        let biyan_data_folder = get_biyan_data_folder_path(app.clone());
        for item in items {
            if let Ok((_, save_path)) =
                resolve_path_within_biyan_data_folder(&biyan_data_folder, &item.save_path)
            {
                let _ = std::fs::remove_file(&save_path); // don't check error
            }
        }
    }

    result.map_err(err_to_string)
}

#[tauri::command]
pub async fn cancel_download_task(state: State<'_, AppState>, task_id: &str) -> Result<(), String> {
    let mut download_manager = state.download_manager.lock().await;
    if let Some(token) = download_manager.cancel_tokens.remove(task_id) {
        token.cancel();
        log::info!("Cancelled download task: {task_id}");
        Ok(())
    } else {
        Err(format!("No download task: {task_id}"))
    }
}
