use std::path::{Path, PathBuf};

use tauri::{AppHandle, Runtime};

use crate::core::app::commands::get_biyan_data_folder_path;

use super::{
    permissions::ComputerAgentScope,
    shell::{shell_status, ShellStatus},
};

#[tauri::command]
pub fn get_computer_agent_shell_status() -> ShellStatus {
    shell_status()
}

#[tauri::command]
pub fn get_computer_agent_workspace_path<R: Runtime>(
    app: AppHandle<R>,
    thread_id: String,
) -> Result<String, String> {
    let data_folder = get_biyan_data_folder_path(app);
    let scope = ComputerAgentScope::new(&data_folder, &thread_id, &[])?;
    scope.ensure_workspace()?;
    Ok(scope.workspace_root.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn validate_computer_agent_allowed_root(path: String) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Allowed root path is required".to_string());
    }

    let path = PathBuf::from(trimmed);
    let canonical = path
        .canonicalize()
        .map_err(|e| format!("Failed to resolve allowed root '{}': {e}", path.display()))?;

    if !canonical.is_dir() {
        return Err(format!(
            "Allowed root '{}' must be a directory",
            canonical.display()
        ));
    }

    if is_filesystem_root(&canonical) {
        return Err("Allowed root cannot be a filesystem root".to_string());
    }

    Ok(canonical.to_string_lossy().into_owned())
}

fn is_filesystem_root(path: &Path) -> bool {
    path.parent().is_none()
}
