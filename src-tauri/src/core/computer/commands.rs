use tauri::{AppHandle, Runtime};

use crate::core::app::commands::get_mita_data_folder_path;

use super::{
    permissions::ComputerScope,
    shell::{shell_status, ShellStatus},
};

#[tauri::command]
pub fn get_computer_shell_status() -> ShellStatus {
    shell_status()
}

#[tauri::command]
pub fn get_computer_workspace_path<R: Runtime>(
    app: AppHandle<R>,
    thread_id: String,
) -> Result<String, String> {
    let data_folder = get_mita_data_folder_path(app);
    let scope = ComputerScope::new(&data_folder, &thread_id, &[])?;
    scope.ensure_workspace()?;
    Ok(scope.workspace_root.to_string_lossy().into_owned())
}
