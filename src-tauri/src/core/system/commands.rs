use sha2::{Digest, Sha256};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime, State};

use crate::core::app::commands::{
    default_data_folder_path, get_biyan_data_folder_path, update_app_configuration,
};
use crate::core::app::constants::{
    BIYAN_DATA_DIRS_COMMON, BIYAN_DATA_DIRS_CONVERSATIONS, BIYAN_DATA_FILES_CONFIGS,
    BIYAN_DATA_FILES_SETTINGS,
};
use crate::core::app::models::AppConfiguration;
use crate::core::mcp::helpers::{stop_mcp_servers_with_context, ShutdownContext};
use crate::core::state::AppState;

const BIYAN_LOCAL_API_MARKER: &str = "# Biyan API Server - Claude Code Config";
const BIYAN_LOCAL_API_MARKER_PREFIX: &str = "# Biyan API Server";
#[cfg(any(windows, test))]
const BIYAN_PROGRAM_DIR_NAME: &str = "Biyan";

fn is_safe_to_delete(path: &std::path::Path) -> bool {
    let count = path.components().count();
    count >= 3
}

fn remove_dir(data_folder: &std::path::Path, name: &str) {
    let path = data_folder.join(name);
    if path.is_dir() {
        log::info!("Removing directory: {}", path.display());
        if let Err(e) = fs::remove_dir_all(&path) {
            log::warn!("Failed to remove {}: {e}", path.display());
        }
    }
}

fn remove_file(data_folder: &std::path::Path, name: &str) {
    let path = data_folder.join(name);
    if path.is_file() {
        log::info!("Removing file: {}", path.display());
        if let Err(e) = fs::remove_file(&path) {
            log::warn!("Failed to remove {}: {e}", path.display());
        }
    }
}

/// Delete conversations and user data (threads, assistants).
fn delete_conversations(data_folder: &std::path::Path) {
    log::info!("Deleting conversations (threads, assistants)");
    for dir in BIYAN_DATA_DIRS_CONVERSATIONS {
        remove_dir(data_folder, dir);
    }
}

/// Delete current Biyan configuration files.
///
/// Retired local-model/RAG data is deliberately excluded. It is user-owned and
/// may only be removed through the inspected, token-confirmed legacy cleanup
/// flow in `legacy_migrations`.
fn delete_configurations(data_folder: &std::path::Path) {
    log::info!("Deleting Biyan configurations");
    for file in BIYAN_DATA_FILES_CONFIGS {
        remove_file(data_folder, file);
    }
}

/// Delete extensions, logs, caches — always cleaned during any reset.
fn delete_common_data(data_folder: &std::path::Path) {
    log::info!("Deleting common data (extensions, logs, caches)");
    for dir in BIYAN_DATA_DIRS_COMMON {
        remove_dir(data_folder, dir);
    }
}

/// Delete cross-category settings (`settings.json`) — only during a full wipe
/// when the user is not keeping any data.
fn delete_settings(data_folder: &std::path::Path) {
    log::info!("Deleting cross-category settings (settings.json)");
    for file in BIYAN_DATA_FILES_SETTINGS {
        remove_file(data_folder, file);
    }
}

/// Detect the user's default shell and return the appropriate env file path.
/// Returns (shell_name, env_file_path).
fn detect_shell_env_file(home_dir: &str, is_macos: bool) -> (&'static str, String) {
    let shell = std::env::var("SHELL").unwrap_or_default();
    if shell.ends_with("/bash") {
        // macOS uses login shells in Terminal, so ~/.bash_profile is sourced.
        // Linux interactive shells source ~/.bashrc.
        let file = if is_macos {
            format!("{}/.bash_profile", home_dir)
        } else {
            format!("{}/.bashrc", home_dir)
        };
        ("bash", file)
    } else {
        // Default to zsh (macOS default since Catalina)
        ("zsh", format!("{}/.zshenv", home_dir))
    }
}

fn should_remove_claude_code_env_line(line: &str) -> bool {
    line.starts_with(BIYAN_LOCAL_API_MARKER)
        || line.starts_with(BIYAN_LOCAL_API_MARKER_PREFIX)
        || crate::core::legacy_migrations::is_legacy_local_api_marker(line)
        || line.starts_with("export ANTHROPIC_")
}

// Helper function to write env vars to a shell config file
fn write_env_to_shell(env_file_path: &str, env_vars: &[(String, String)]) -> Result<(), String> {
    let new_entries: String = env_vars
        .iter()
        .map(|(k, v)| format!("export {}='{}'\n", k, v))
        .collect();

    let existing_content = std::fs::read_to_string(env_file_path).unwrap_or_default();
    let cleaned: Vec<&str> = existing_content
        .split('\n')
        .filter(|line| !should_remove_claude_code_env_line(line))
        .collect();

    let new_content = format!(
        "{}\n{}\n{}\n",
        BIYAN_LOCAL_API_MARKER, new_entries, BIYAN_LOCAL_API_MARKER
    );

    let final_content = cleaned.join("\n") + &new_content;
    std::fs::write(env_file_path, &final_content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn factory_reset<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    state: State<'_, AppState>,
    keep_app_data: Option<bool>,
    keep_configurations: Option<bool>,
) {
    let keep_app_data = keep_app_data.unwrap_or(false);
    let keep_configurations = keep_configurations.unwrap_or(false);

    #[cfg(not(any(target_os = "ios", target_os = "android")))]
    {
        let windows = app_handle.webview_windows();
        for (label, window) in windows.iter() {
            window.close().unwrap_or_else(|_| {
                log::warn!("Failed to close window: {label:?}");
            });
        }
    }
    let data_folder = get_biyan_data_folder_path(app_handle.clone());
    let user_logs_dir = crate::core::user_logs::resolve_user_logs_directory(&app_handle).ok();
    log::info!(
        "Factory reset (keep_app_data={}, keep_configurations={}), data folder: {:?}",
        keep_app_data,
        keep_configurations,
        data_folder
    );

    tauri::async_runtime::block_on(async {
        let _ =
            stop_mcp_servers_with_context(&app_handle, &state, ShutdownContext::FactoryReset).await;

        {
            let mut active_servers = state.mcp_active_servers.lock().await;
            active_servers.clear();
        }

        use crate::core::mcp::lockfile::cleanup_own_locks;
        if let Err(e) = cleanup_own_locks(&app_handle) {
            log::warn!("Failed to cleanup lock files: {}", e);
        }
        if data_folder.exists() {
            if !is_safe_to_delete(&data_folder) {
                log::error!(
                    "Refusing factory reset: path is too close to filesystem root: {}",
                    data_folder.display()
                );
                return;
            }

            // Always clean common data (extensions, logs, caches)
            delete_common_data(&data_folder);

            // Delete conversations (threads, assistants) unless user chose to keep it
            if !keep_app_data {
                delete_conversations(&data_folder);
            }

            // Delete current configurations unless the user chose to keep them.
            // Retired local-runtime data is never part of factory reset.
            if !keep_configurations {
                delete_configurations(&data_folder);
            }

            // store.json spans all categories; only wipe it when nothing is kept
            if !keep_app_data && !keep_configurations {
                delete_settings(&data_folder);
            }
        }

        if let Some(user_logs_dir) = user_logs_dir {
            if let Err(e) = crate::core::user_logs::clear_user_log_files(&user_logs_dir) {
                eprintln!(
                    "Failed to clear Biyan local logs during factory reset ({}): {}",
                    user_logs_dir.display(),
                    e
                );
            }
        }

        // Reset app configuration to defaults unless user chose to keep configs
        if !keep_configurations {
            let mut default_config = AppConfiguration::default();
            default_config.data_folder = default_data_folder_path(app_handle.clone());
            let _ = update_app_configuration(app_handle.clone(), default_config);
        }

        app_handle.restart();
    });
}

#[tauri::command]
pub fn relaunch<R: Runtime>(app: AppHandle<R>) {
    app.restart()
}

#[tauri::command]
pub fn open_app_directory<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let app_path = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Failed to resolve app directory: {err}"))?;
    open_path_in_file_manager(&app_path)
}

/// Opens the deterministic primary legacy source without modifying it. The
/// complete ordered list is exposed separately on the migration recovery page;
/// normal runtime code always resolves the canonical Biyan directory.
#[tauri::command]
pub fn open_legacy_migration_source<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    crate::core::legacy_migrations::recovery_legacy_sources_for_app(&app)?
        .into_iter()
        .next()
        .ok_or_else(|| "No legacy data source was found".to_string())
        .and_then(|path| open_path_in_file_manager(&path))
}

#[tauri::command]
pub fn open_file_explorer(path: String) -> Result<(), String> {
    let path = PathBuf::from(path);
    open_path_in_file_manager(&path)
}

fn open_path_in_file_manager(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let path_str = normalize_windows_explorer_path(path);
        let path_arg = std::ffi::OsString::from(path_str);
        return spawn_file_manager("explorer", [path_arg], "open file explorer");
    }

    #[cfg(target_os = "macos")]
    {
        return spawn_file_manager("open", [path.as_os_str()], "open file explorer");
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        spawn_file_manager("xdg-open", [path.as_os_str()], "open file explorer")
    }
}

fn spawn_file_manager<I, A>(program: &str, args: I, action: &str) -> Result<(), String>
where
    I: IntoIterator<Item = A>,
    A: AsRef<std::ffi::OsStr>,
{
    std::process::Command::new(program)
        .args(args)
        .spawn()
        .map(|_| ())
        .map_err(|err| {
            log::warn!("Failed to {action}: {err}");
            format!("Failed to {action}: {err}")
        })
}

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_explorer_path(path: &Path) -> String {
    // Normalize extended-length paths (\\?\...) for explorer compatibility.
    let mut path_str = path.to_string_lossy().into_owned();
    if let Some(stripped) = path_str.strip_prefix(r"\\?\UNC\") {
        path_str = format!(r"\\{}", stripped);
    } else if let Some(stripped) = path_str.strip_prefix(r"\\?\") {
        path_str = stripped.to_string();
    }
    path_str
}

#[tauri::command]
pub async fn read_logs<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    crate::core::user_logs::read_user_logs(app, None)
}

#[tauri::command]
pub fn launch_claude_code_with_config(
    api_url: String,
    api_key: Option<String>,
    big_model: Option<String>,
    medium_model: Option<String>,
    small_model: Option<String>,
    custom_env_vars: Vec<serde_json::Value>,
) -> Result<(), String> {
    // Clone values for logging before moving
    let api_url_log = api_url.clone();
    let big_model_log = big_model.clone();
    let medium_model_log = medium_model.clone();
    let small_model_log = small_model.clone();

    let mut env_vars: Vec<(String, String)> = Vec::with_capacity(8);
    env_vars.push(("ANTHROPIC_BASE_URL".to_string(), api_url));

    env_vars.push((
        "ANTHROPIC_AUTH_TOKEN".to_string(),
        api_key.unwrap_or_else(|| "biyan".to_string()),
    ));

    if let Some(model) = big_model {
        env_vars.push(("ANTHROPIC_DEFAULT_OPUS_MODEL".to_string(), model));
    }

    if let Some(model) = medium_model {
        env_vars.push(("ANTHROPIC_DEFAULT_SONNET_MODEL".to_string(), model));
    }

    if let Some(model) = small_model {
        env_vars.push(("ANTHROPIC_DEFAULT_HAIKU_MODEL".to_string(), model));
    }

    // Add custom env vars from the custom CLI section
    for env in &custom_env_vars {
        if let (Some(key), Some(value)) = (
            env.get("key").and_then(|v| v.as_str()),
            env.get("value").and_then(|v| v.as_str()),
        ) {
            env_vars.push((key.to_string(), value.to_string()));
        }
    }

    log::info!(
        "Launching Claude Code with API URL: {}, models: opus={:?}, sonnet={:?}, haiku={:?}, custom_envs={}",
        api_url_log,
        big_model_log,
        medium_model_log,
        small_model_log,
        custom_env_vars.len()
    );

    // Build the command environment
    // Export environment variables to the user's shell config file

    if cfg!(target_os = "macos") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, true);
        log::info!(
            "Detected shell: {}, writing env to: {}",
            shell_name,
            env_file_path
        );

        // Try direct write first
        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&env_file_path)
        {
            Ok(_) => {
                write_env_to_shell(&env_file_path, &env_vars)?;
                return Ok(());
            }
            Err(_) => {
                // Use admin privileges to write
                let existing_content = std::fs::read_to_string(&env_file_path).unwrap_or_default();
                let cleaned: Vec<&str> = existing_content
                    .split('\n')
                    .filter(|line| !should_remove_claude_code_env_line(line))
                    .collect();

                let env_content: String = env_vars
                    .iter()
                    .map(|(k, v)| format!("export {}='{}'\n", k, v))
                    .collect();

                let new_block = format!("{}\n{}", BIYAN_LOCAL_API_MARKER, env_content);

                let final_content = cleaned.join("\n") + "\n" + &new_block + BIYAN_LOCAL_API_MARKER;

                // Write to a temp file first, then use osascript to move it
                let temp_script_path = format!("{}/.biyan_env_update.sh", home_dir);
                std::fs::write(&temp_script_path, &final_content).map_err(|e| e.to_string())?;

                // Use admin privileges to move the temp file
                let script = format!(
                    r#"do shell script "cp '{}' '{}' && rm '{}' && echo 'Env vars written to {}'" with administrator privileges"#,
                    temp_script_path, env_file_path, temp_script_path, env_file_path
                );

                std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(&script)
                    .output()
                    .map_err(|e| e.to_string())?;

                log::info!(
                    "Env vars written to {} with admin privileges",
                    env_file_path
                );
                return Ok(());
            }
        }
    } else if cfg!(target_os = "linux") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, false);
        log::info!(
            "Detected shell: {}, writing env to: {}",
            shell_name,
            env_file_path
        );

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&env_file_path)
        {
            Ok(_) => {
                write_env_to_shell(&env_file_path, &env_vars)?;
                return Ok(());
            }
            Err(_) => {
                let biyan_config_dir = format!("{}/.config/biyan", home_dir);
                let ext = if shell_name == "bash" { "bash" } else { "zsh" };
                let env_file = format!("{}/claude-code-env.{}", biyan_config_dir, ext);
                return Err(format!("NEED_PERMISSION:{}", env_file));
            }
        }
    } else {
        // On Windows, set persistent user environment variables using setx
        for (key, value) in &env_vars {
            let output = std::process::Command::new("setx")
                .arg(key)
                .arg(value)
                .output()
                .map_err(|e| e.to_string())?;

            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Failed to set env var {}: {}", key, stderr));
            }
        }

        log::info!("Environment variables set permanently in Windows registry.");
        return Ok(());
    }
}

#[derive(serde::Serialize)]
pub struct CliInstallStatus {
    pub installed: bool,
    pub path: Option<String>,
}

const CLI_INSTALL_SCHEMA: u32 = 1;
// Exact SHA-256 fingerprints of product-managed 0.6.633 CLI binaries extracted from the
// immutable Windows and macOS artifacts referenced by the official 0.6.633 updater manifest.
// Do not add a locally built fingerprint here unless its provenance can be reproduced from a
// published artifact; an unknown hash must be preserved and reported.
const LEGACY_MANAGED_CLI_SHA256: &[&str] = &[
    "2c67c5fe538fad95c812b4b0525a311b2bd02d762889706b4fd50c7bb0a38719",
    "ca39d2f67b3bb2ea0851c8253805b09a3379051d164b111d3c2201133d60e4ae",
];

fn cli_install_marker(destination: &Path) -> PathBuf {
    let name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("biyan");
    destination.with_file_name(format!("{name}.install.json"))
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path)
        .map_err(|error| format!("Failed to open {} for hashing: {error}", path.display()))?;
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("Failed to hash {}: {error}", path.display()))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn clear_cli_staging_file(staging: &Path) -> Result<(), String> {
    #[cfg(windows)]
    match std::fs::symlink_metadata(staging) {
        Ok(metadata) if metadata.file_type().is_file() && metadata.permissions().readonly() => {
            let mut writable = metadata.permissions();
            writable.set_readonly(false);
            std::fs::set_permissions(staging, writable).map_err(|error| {
                format!(
                    "Failed to make stale Biyan CLI staging file removable {}: {error}",
                    staging.display()
                )
            })?;
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(format!(
                "Failed to inspect stale Biyan CLI staging file {}: {error}",
                staging.display()
            ))
        }
    }

    match std::fs::remove_file(staging) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!(
            "Failed to clear stale Biyan CLI staging file {}: {error}",
            staging.display()
        )),
    }
}

fn replace_managed_cli_atomically(staging: &Path, destination: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        let original_permissions = match std::fs::symlink_metadata(destination) {
            Ok(metadata) if metadata.file_type().is_file() => Some(metadata.permissions()),
            Ok(_) => None,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(format!("inspect_cli_destination:{error}")),
        };
        let restore_permissions = original_permissions
            .as_ref()
            .filter(|permissions| permissions.readonly())
            .cloned();
        if let Some(original) = &restore_permissions {
            let mut writable = original.clone();
            writable.set_readonly(false);
            std::fs::set_permissions(destination, writable)
                .map_err(|error| format!("prepare_cli_destination:{error}"))?;
        }

        return match crate::core::legacy_migrations::atomic_replace(staging, destination) {
            Ok(()) => Ok(()),
            Err(replace_error) => {
                if let Some(original) = restore_permissions {
                    if let Err(restore_error) = std::fs::set_permissions(destination, original) {
                        return Err(format!(
                            "{replace_error}; restore_cli_destination_permissions:{restore_error}"
                        ));
                    }
                }
                Err(replace_error)
            }
        };
    }

    #[cfg(not(windows))]
    crate::core::legacy_migrations::atomic_replace(staging, destination)
}

fn reconcile_cli_binary(source: &Path, destination: &Path) -> Result<(), String> {
    let expected_digest = sha256_file(source)?;
    let marker = cli_install_marker(destination);
    let marker_matches = std::fs::read_to_string(&marker)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .is_some_and(|value| {
            value.get("schema").and_then(serde_json::Value::as_u64)
                == Some(CLI_INSTALL_SCHEMA as u64)
                && value.get("sha256").and_then(serde_json::Value::as_str)
                    == Some(expected_digest.as_str())
        });
    if marker_matches
        && destination.is_file()
        && sha256_file(destination).ok().as_deref() == Some(expected_digest.as_str())
    {
        return Ok(());
    }

    let parent = destination
        .parent()
        .ok_or_else(|| "Biyan CLI destination has no parent directory".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "Failed to create Biyan CLI directory {}: {error}",
            parent.display()
        )
    })?;
    let staging = parent.join(format!(".biyan.installing-{}", std::process::id()));
    clear_cli_staging_file(&staging)?;
    std::fs::copy(source, &staging).map_err(|error| {
        format!(
            "Failed to stage Biyan CLI at {}: {error}",
            staging.display()
        )
    })?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&staging, std::fs::Permissions::from_mode(0o755))
            .map_err(|error| format!("Failed to set Biyan CLI permissions: {error}"))?;
    }
    #[cfg(windows)]
    {
        let mut permissions = std::fs::metadata(&staging)
            .map_err(|error| format!("Failed to read staged Biyan CLI permissions: {error}"))?
            .permissions();
        if permissions.readonly() {
            permissions.set_readonly(false);
            std::fs::set_permissions(&staging, permissions)
                .map_err(|error| format!("Failed to make staged Biyan CLI updatable: {error}"))?;
        }
    }
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(&staging)
        .and_then(|file| file.sync_all())
        .map_err(|error| format!("Failed to sync staged Biyan CLI: {error}"))?;
    if sha256_file(&staging)? != expected_digest {
        let _ = std::fs::remove_file(&staging);
        return Err("Biyan CLI staging digest mismatch".to_string());
    }

    replace_managed_cli_atomically(&staging, destination)
        .map_err(|error| format!("CLI_LOCKED: failed to commit Biyan CLI atomically: {error}"))?;

    let marker_json = serde_json::json!({
        "schema": CLI_INSTALL_SCHEMA,
        "sha256": expected_digest,
    });
    let marker_bytes = serde_json::to_vec_pretty(&marker_json)
        .map_err(|error| format!("Failed to serialize Biyan CLI marker: {error}"))?;
    crate::core::legacy_migrations::atomic_write(&marker, &marker_bytes)
        .map_err(|error| format!("Failed to commit Biyan CLI marker: {error}"))?;
    Ok(())
}

fn managed_cli_marker_matches_binary(destination: &Path) -> bool {
    let marker = cli_install_marker(destination);
    let managed_digest = std::fs::read_to_string(marker)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| {
            (value.get("schema").and_then(serde_json::Value::as_u64)
                == Some(CLI_INSTALL_SCHEMA as u64))
            .then(|| {
                value
                    .get("sha256")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_owned)
            })
            .flatten()
        });
    managed_digest
        .as_deref()
        .is_some_and(|digest| sha256_file(destination).ok().as_deref() == Some(digest))
}

fn reconcile_managed_legacy_cli_shim_with_hashes(
    source: &Path,
    destination: &Path,
    known_legacy_hashes: &[&str],
) -> Result<bool, String> {
    if !destination.exists() {
        reconcile_cli_binary(source, destination)?;
        return Ok(true);
    }

    let already_managed = managed_cli_marker_matches_binary(destination);
    let source_digest = sha256_file(source)?;
    let current_digest = sha256_file(destination).ok();
    let known_legacy = current_digest
        .as_deref()
        .is_some_and(|digest| known_legacy_hashes.contains(&digest));
    let staged_without_marker = current_digest.as_deref() == Some(source_digest.as_str());
    if !(already_managed || known_legacy || staged_without_marker) {
        log::warn!(
            "An unrecognized predecessor CLI exists at {}; preserving it without writing a managed-install marker",
            destination.display()
        );
        return Ok(false);
    }

    if known_legacy && !already_managed {
        log::info!(
            "Taking over verified product-managed 0.6.633 CLI at {}",
            destination.display()
        );
    } else if staged_without_marker && !already_managed {
        log::info!(
            "Recovering interrupted managed CLI marker commit at {}",
            destination.display()
        );
    }
    reconcile_cli_binary(source, destination)?;
    Ok(true)
}

fn reconcile_legacy_cli_locations(
    source: &Path,
    primary: &Path,
    locations: &[PathBuf],
    keep_shim: bool,
) -> Result<(), String> {
    reconcile_legacy_cli_locations_with_hashes(
        source,
        primary,
        locations,
        keep_shim,
        LEGACY_MANAGED_CLI_SHA256,
    )
}

fn reconcile_legacy_cli_locations_with_hashes(
    source: &Path,
    primary: &Path,
    locations: &[PathBuf],
    keep_shim: bool,
    known_legacy_hashes: &[&str],
) -> Result<(), String> {
    let mut visited = Vec::<PathBuf>::new();
    for destination in locations {
        if visited.contains(destination) {
            continue;
        }
        visited.push(destination.clone());

        let create_primary = keep_shim && destination == primary;
        if destination.exists() || create_primary {
            let managed = reconcile_managed_legacy_cli_shim_with_hashes(
                source,
                destination,
                known_legacy_hashes,
            )?;
            if !keep_shim && managed {
                remove_managed_legacy_cli_shim(destination)?;
            }
        } else if !keep_shim {
            // Clear an orphaned marker from an interrupted A/B uninstall without creating a C shim.
            remove_managed_legacy_cli_shim(destination)?;
        }
    }
    Ok(())
}

fn remove_managed_legacy_cli_shim(destination: &Path) -> Result<(), String> {
    let marker = cli_install_marker(destination);
    if !destination.exists() {
        let _ = std::fs::remove_file(marker);
        return Ok(());
    }
    if !managed_cli_marker_matches_binary(destination) {
        log::warn!(
            "A user-owned predecessor CLI exists at {}; C will not remove it",
            destination.display()
        );
        return Ok(());
    }
    std::fs::remove_file(destination)
        .map_err(|error| format!("Failed to remove managed predecessor CLI: {error}"))?;
    std::fs::remove_file(marker)
        .map_err(|error| format!("Failed to remove managed predecessor CLI marker: {error}"))
}

/// Check if the `biyan` CLI binary is accessible on PATH.
#[tauri::command]
pub async fn check_biyan_cli_installed() -> CliInstallStatus {
    let which_cmd = if cfg!(windows) { "where" } else { "which" };
    let mut cmd = std::process::Command::new(which_cmd);
    cmd.arg("biyan");

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    match tokio::task::spawn_blocking(move || cmd.output()).await {
        Ok(Ok(out)) if out.status.success() => {
            let raw = String::from_utf8_lossy(&out.stdout);
            #[cfg(windows)]
            let path = {
                // `where` returns one path per line; pick the first that isn't a
                // dev-build artifact (i.e. skip paths containing \target\)
                raw.lines()
                    .map(str::trim)
                    .filter(|p| !p.is_empty() && !p.to_ascii_lowercase().contains("\\target\\"))
                    .next()
                    .map(str::to_string)
                    // fall back to the raw first line if every path looks like a build dir
                    .or_else(|| {
                        raw.lines()
                            .map(str::trim)
                            .find(|p| !p.is_empty())
                            .map(str::to_string)
                    })
            };
            #[cfg(not(windows))]
            let path = Some(raw.trim().to_string());
            CliInstallStatus {
                installed: path.is_some(),
                path,
            }
        }
        _ => CliInstallStatus {
            installed: false,
            path: None,
        },
    }
}

/// Core install logic — synchronous, no Tauri command overhead.
pub fn install_biyan_cli_sync<R: Runtime>(
    app_handle: &AppHandle<R>,
) -> Result<CliInstallStatus, String> {
    let bin_name = if cfg!(windows) {
        "biyan-cli.exe"
    } else {
        "biyan-cli"
    };
    let dest_bin_name = if cfg!(windows) { "biyan.exe" } else { "biyan" };
    let resource_bin_dir = app_handle
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("resources/bin");
    let bundled = resource_bin_dir.join(bin_name);
    #[cfg(windows)]
    let dest = resource_bin_dir.join(dest_bin_name);

    if !bundled.exists() {
        return Err("Biyan CLI binary not bundled with this version of Biyan.".to_string());
    }

    #[cfg(windows)]
    {
        reconcile_cli_binary(&bundled, &dest)?;
        let legacy_shim =
            resource_bin_dir.join(crate::core::legacy_migrations::legacy_cli_shim_file_name());
        let mut legacy_locations = vec![legacy_shim.clone()];
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            legacy_locations.extend(legacy_windows_cli_candidates_from_local_app_data(
                local_app_data,
            ));
        }
        let keep_legacy_shim = crate::core::legacy_migrations::compiled_target_data_schema() <= 2;
        reconcile_legacy_cli_locations(
            &bundled,
            &legacy_shim,
            &legacy_locations,
            keep_legacy_shim,
        )?;
        add_to_path_windows(&resource_bin_dir, !keep_legacy_shim)?;
        return Ok(CliInstallStatus {
            installed: true,
            path: Some(dest.to_string_lossy().into_owned()),
        });
    }

    #[cfg(unix)]
    {
        let install_dir = biyan_cli_install_dir()?;
        std::fs::create_dir_all(&install_dir).map_err(|e| e.to_string())?;
        let dest = install_dir.join(dest_bin_name);

        reconcile_cli_binary(&bundled, &dest)?;
        let legacy_shim =
            install_dir.join(crate::core::legacy_migrations::legacy_cli_shim_file_name());
        let home = std::env::var("HOME")
            .map(PathBuf::from)
            .map_err(|_| "Cannot determine home directory".to_string())?;
        let mut legacy_locations = vec![legacy_shim.clone()];
        legacy_locations.extend(legacy_unix_cli_candidates(
            &home,
            Path::new("/usr/local/bin"),
        ));
        reconcile_legacy_cli_locations(
            &bundled,
            &legacy_shim,
            &legacy_locations,
            crate::core::legacy_migrations::compiled_target_data_schema() <= 2,
        )?;

        if legacy_locations
            .iter()
            .filter(|candidate| candidate.exists())
            .count()
            > 1
        {
            log::info!("Reconciled predecessor CLI copies across multiple Unix PATH locations");
        }

        Ok(CliInstallStatus {
            installed: true,
            path: Some(dest.to_string_lossy().into_owned()),
        })
    }
}

/// Copy the bundled `biyan` binary to the system PATH (Tauri command wrapper).
#[tauri::command]
pub async fn install_biyan_cli<R: Runtime>(
    app_handle: AppHandle<R>,
) -> Result<CliInstallStatus, String> {
    install_biyan_cli_sync(&app_handle)
}

/// Remove the installed `biyan` CLI binary.
#[tauri::command]
pub fn uninstall_biyan_cli() -> Result<(), String> {
    #[cfg(windows)]
    {
        let bin_dir = biyan_cli_bin_dir_windows()?;
        let mut legacy_locations =
            vec![bin_dir.join(crate::core::legacy_migrations::legacy_cli_shim_file_name())];
        if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
            legacy_locations.extend(legacy_windows_cli_candidates_from_local_app_data(
                local_app_data,
            ));
        }
        legacy_locations.sort();
        legacy_locations.dedup();
        for legacy_shim in legacy_locations {
            remove_managed_legacy_cli_shim(&legacy_shim)?;
        }
        remove_from_path_windows(&bin_dir)?;
        return Ok(());
    }

    #[cfg(unix)]
    {
        let dest = biyan_cli_install_dir()?.join("biyan");
        if dest.exists() {
            std::fs::remove_file(&dest).map_err(|e| {
                format!("Failed to remove Biyan CLI from {}: {}", dest.display(), e)
            })?;
        }
        let home = std::env::var("HOME")
            .map(PathBuf::from)
            .map_err(|_| "Cannot determine home directory".to_string())?;
        let mut legacy_locations = legacy_unix_cli_candidates(&home, Path::new("/usr/local/bin"));
        legacy_locations.push(
            biyan_cli_install_dir()?
                .join(crate::core::legacy_migrations::legacy_cli_shim_file_name()),
        );
        legacy_locations.sort();
        legacy_locations.dedup();
        for legacy_shim in legacy_locations {
            remove_managed_legacy_cli_shim(&legacy_shim)?;
        }
        Ok(())
    }
}

/// Build the cleaned shell-file content with all Biyan CC env vars stripped out.
fn build_cleaned_env_content(env_file_path: &str) -> String {
    let existing_content = std::fs::read_to_string(env_file_path).unwrap_or_default();
    let cleaned: Vec<&str> = existing_content
        .split('\n')
        .filter(|line| !should_remove_claude_code_env_line(line))
        .collect();
    // Trim trailing blank lines left behind by the removed block
    cleaned.join("\n").trim_end().to_string() + "\n"
}

/// Clear all Biyan-written Claude Code environment variables from the shell config.
/// Uses the same write-probe + osascript-fallback logic as `launch_claude_code_with_config`.
#[tauri::command]
pub fn clear_claude_code_env() -> Result<(), String> {
    if cfg!(target_os = "macos") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, true);
        log::info!(
            "Clearing CC env from shell: {}, file: {}",
            shell_name,
            env_file_path
        );

        let cleaned = build_cleaned_env_content(&env_file_path);

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&env_file_path)
        {
            Ok(_) => {
                std::fs::write(&env_file_path, &cleaned).map_err(|e| e.to_string())?;
                return Ok(());
            }
            Err(_) => {
                // Write cleaned content to a temp file, then use osascript to move it
                let temp_path = format!("{}/.biyan_env_clear.sh", home_dir);
                std::fs::write(&temp_path, &cleaned).map_err(|e| e.to_string())?;

                let script = format!(
                    r#"do shell script "cp '{}' '{}' && rm '{}'" with administrator privileges"#,
                    temp_path, env_file_path, temp_path
                );

                std::process::Command::new("osascript")
                    .arg("-e")
                    .arg(&script)
                    .output()
                    .map_err(|e| e.to_string())?;

                log::info!(
                    "CC env cleared from {} with admin privileges",
                    env_file_path
                );
                return Ok(());
            }
        }
    } else if cfg!(target_os = "linux") {
        let home_dir = std::env::var("HOME").map_err(|e| e.to_string())?;
        let (shell_name, env_file_path) = detect_shell_env_file(&home_dir, false);
        log::info!(
            "Clearing CC env from shell: {}, file: {}",
            shell_name,
            env_file_path
        );

        let cleaned = build_cleaned_env_content(&env_file_path);

        match std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .open(&env_file_path)
        {
            Ok(_) => {
                std::fs::write(&env_file_path, &cleaned).map_err(|e| e.to_string())?;
                Ok(())
            }
            Err(_) => Err(format!("NEED_PERMISSION:{}", env_file_path)),
        }
    } else {
        // Windows: delete the persistent user env vars from the registry
        let keys = [
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_DEFAULT_OPUS_MODEL",
            "ANTHROPIC_DEFAULT_SONNET_MODEL",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL",
        ];
        for key in &keys {
            let _ = std::process::Command::new("reg")
                .args(["delete", "HKCU\\Environment", "/v", key, "/f"])
                .output();
        }
        log::info!("CC env vars removed from Windows registry.");
        Ok(())
    }
}

/// Determine the best writable directory for the Biyan CLI install (Unix only).
#[cfg(unix)]
fn biyan_cli_install_dir() -> Result<PathBuf, String> {
    let usr_local_bin = PathBuf::from("/usr/local/bin");
    if usr_local_bin.exists() {
        let probe = usr_local_bin.join(".biyan_write_probe");
        if std::fs::write(&probe, b"").is_ok() {
            let _ = std::fs::remove_file(&probe);
            return Ok(usr_local_bin);
        }
    }
    let home = std::env::var("HOME").map_err(|_| "Cannot determine home directory".to_string())?;
    Ok(PathBuf::from(home).join(".local").join("bin"))
}

fn legacy_unix_cli_candidates(home: &Path, usr_local_bin: &Path) -> Vec<PathBuf> {
    vec![
        usr_local_bin.join("mita"),
        home.join(".local").join("bin").join("mita"),
    ]
}

/// Return the directory containing the bundled CLI binary on Windows.
#[cfg(windows)]
fn biyan_cli_bin_dir_windows() -> Result<PathBuf, String> {
    let local_app_data =
        std::env::var("LOCALAPPDATA").map_err(|_| "Cannot determine LOCALAPPDATA".to_string())?;
    Ok(biyan_cli_bin_dir_from_local_app_data(local_app_data))
}

#[cfg(any(windows, test))]
fn biyan_cli_bin_dir_from_local_app_data(local_app_data: impl AsRef<Path>) -> PathBuf {
    local_app_data
        .as_ref()
        .join("Programs")
        .join(BIYAN_PROGRAM_DIR_NAME)
        .join("resources")
        .join("bin")
}

#[cfg(any(windows, test))]
fn legacy_windows_cli_candidates_from_local_app_data(
    local_app_data: impl AsRef<Path>,
) -> Vec<PathBuf> {
    let programs = local_app_data.as_ref().join("Programs");
    let mut candidates = Vec::new();
    for product in [BIYAN_PROGRAM_DIR_NAME, "Mita"] {
        let install_dir = programs.join(product);
        let resource_bin = install_dir.join("resources").join("bin");
        candidates.push(resource_bin.join("mita.exe"));
        candidates.push(resource_bin.join("mita-cli.exe"));
        candidates.push(install_dir.join("mita-cli.exe"));
    }
    candidates
}

#[cfg(any(windows, test))]
fn windows_path_identity(path: &str) -> String {
    path.trim()
        .trim_matches('"')
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

#[cfg(any(windows, test))]
fn windows_user_path_with_biyan_first(
    existing: &str,
    install_dir: &Path,
    remove_predecessor_entries: bool,
) -> String {
    let install_dir_str = install_dir.to_string_lossy().to_string();
    let install_identity = windows_path_identity(&install_dir_str);
    let mut blocked = vec![install_identity.clone()];
    if let Some(biyan_install_dir) = install_identity.strip_suffix("\\resources\\bin") {
        blocked.push(biyan_install_dir.to_string());
        if remove_predecessor_entries {
            if let Some((programs_dir, _)) = biyan_install_dir.rsplit_once('\\') {
                let legacy_install_dir = format!(r"{programs_dir}\mita");
                blocked.push(legacy_install_dir.clone());
                blocked.push(format!(r"{legacy_install_dir}\resources\bin"));
            }
        }
    }

    let mut new_parts = vec![install_dir_str];
    new_parts.extend(
        existing
            .split(';')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .filter(|part| !blocked.contains(&windows_path_identity(part)))
            .map(str::to_owned),
    );
    new_parts.join(";")
}

/// Add a directory to the Windows user PATH.
#[cfg(windows)]
fn add_to_path_windows(
    install_dir: &PathBuf,
    remove_predecessor_entries: bool,
) -> Result<(), String> {
    use std::process::Command;

    let install_dir_str = install_dir.to_string_lossy().to_string();

    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path', 'User')",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let read_output = cmd
        .output()
        .map_err(|e| format!("Failed to read user PATH: {}", e))?;

    let existing_user_path = String::from_utf8_lossy(&read_output.stdout)
        .trim()
        .to_string();

    // Put Biyan first even if it was already present later in PATH. A/B retain predecessor PATH
    // entries after the verified retired shim; C removes those managed entries after shim cleanup.
    let new_path = windows_user_path_with_biyan_first(
        &existing_user_path,
        install_dir,
        remove_predecessor_entries,
    );
    if new_path == existing_user_path {
        return Ok(());
    }

    let mut cmd_write = Command::new("powershell");
    cmd_write.args([
        "-NoProfile",
        "-Command",
        &format!(
            "[Environment]::SetEnvironmentVariable('Path', '{}', 'User')",
            new_path.replace('\'', "''")
        ),
    ]);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd_write.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    let write_output = cmd_write
        .output()
        .map_err(|e| format!("Failed to update user PATH: {}", e))?;

    if !write_output.status.success() {
        return Err(format!(
            "Failed to update PATH: {}",
            String::from_utf8_lossy(&write_output.stderr)
        ));
    }

    log::info!("Added {} to Windows user PATH", install_dir_str);
    Ok(())
}

/// Remove a directory from the Windows user PATH.
#[cfg(windows)]
fn remove_from_path_windows(dir: &PathBuf) -> Result<(), String> {
    use std::process::Command;

    let dir_str = dir.to_string_lossy().to_string();

    let mut cmd = Command::new("powershell");
    cmd.args([
        "-NoProfile",
        "-Command",
        "[Environment]::GetEnvironmentVariable('Path', 'User')",
    ]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let read_output = cmd
        .output()
        .map_err(|e| format!("Failed to read user PATH: {}", e))?;

    let existing_user_path = String::from_utf8_lossy(&read_output.stdout)
        .trim()
        .to_string();

    let new_path: String = existing_user_path
        .split(';')
        .filter(|p| !p.is_empty() && !p.eq_ignore_ascii_case(&dir_str))
        .collect::<Vec<_>>()
        .join(";");

    if new_path.len() != existing_user_path.len() {
        let mut cmd_write = Command::new("powershell");
        cmd_write.args([
            "-NoProfile",
            "-Command",
            &format!(
                "[Environment]::SetEnvironmentVariable('Path', '{}', 'User')",
                new_path.replace('\'', "''")
            ),
        ]);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd_write.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let write_output = cmd_write
            .output()
            .map_err(|e| format!("Failed to update user PATH: {}", e))?;

        if !write_output.status.success() {
            return Err(format!(
                "Failed to update PATH: {}",
                String::from_utf8_lossy(&write_output.stderr)
            ));
        }

        log::info!("Removed {} from Windows user PATH", dir_str);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::app::constants::*;
    use crate::core::legacy_migrations::LEGACY_LOCAL_DATA_DIRS;
    use std::fs;
    use tempfile::tempdir;

    fn create_all_data(dir: &std::path::Path) {
        for subdir in BIYAN_DATA_SUBDIRS
            .iter()
            .chain(LEGACY_LOCAL_DATA_DIRS.iter())
        {
            fs::create_dir_all(dir.join(subdir)).unwrap();
            fs::write(dir.join(subdir).join("dummy.txt"), "data").unwrap();
        }
        for file in BIYAN_DATA_FILES {
            fs::write(dir.join(file), "data").unwrap();
        }
    }

    fn exists_any(dir: &std::path::Path, names: &[&str]) -> bool {
        names.iter().any(|n| dir.join(n).exists())
    }

    fn exists_all(dir: &std::path::Path, names: &[&str]) -> bool {
        names.iter().all(|n| dir.join(n).exists())
    }

    fn make_test_file_readonly(path: &Path) {
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[cfg(windows)]
    fn make_test_file_writable(path: &Path) {
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[test]
    fn test_write_env_to_shell_uses_biyan_marker_and_cleans_legacy() {
        let tmp = tempdir().unwrap();
        let env_file = tmp.path().join("env");
        let legacy_marker = crate::core::legacy_migrations::legacy_local_api_marker_fixture();
        fs::write(
            &env_file,
            format!(
                "KEEP_ME=1\n{}\nexport ANTHROPIC_AUTH_TOKEN='old'\n{}\n",
                legacy_marker, BIYAN_LOCAL_API_MARKER
            ),
        )
        .unwrap();

        write_env_to_shell(
            env_file.to_str().unwrap(),
            &[("ANTHROPIC_AUTH_TOKEN".to_string(), "new".to_string())],
        )
        .unwrap();

        let content = fs::read_to_string(&env_file).unwrap();
        assert!(content.contains("KEEP_ME=1"));
        assert!(content.contains(BIYAN_LOCAL_API_MARKER));
        assert!(content.contains("export ANTHROPIC_AUTH_TOKEN='new'"));
        assert!(!content.contains(legacy_marker));
        assert!(!content.contains("export ANTHROPIC_AUTH_TOKEN='old'"));
    }

    #[test]
    fn test_build_cleaned_env_content_removes_biyan_and_legacy_markers() {
        let tmp = tempdir().unwrap();
        let env_file = tmp.path().join("env");
        let legacy_marker = crate::core::legacy_migrations::legacy_local_api_marker_fixture();
        fs::write(
            &env_file,
            format!(
                "KEEP_ME=1\n{}\n{}\nexport ANTHROPIC_BASE_URL='old'\n",
                BIYAN_LOCAL_API_MARKER, legacy_marker
            ),
        )
        .unwrap();

        let content = build_cleaned_env_content(env_file.to_str().unwrap());
        assert!(content.contains("KEEP_ME=1"));
        assert!(!content.contains(BIYAN_LOCAL_API_MARKER));
        assert!(!content.contains(legacy_marker));
        assert!(!content.contains("export ANTHROPIC_BASE_URL"));
    }

    #[test]
    fn test_delete_conversations_only_removes_conversation_dirs() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_conversations(d);

        assert!(!exists_any(d, BIYAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, LEGACY_LOCAL_DATA_DIRS));
        assert!(exists_all(d, BIYAN_DATA_DIRS_COMMON));
        assert!(d.join("settings.json").exists());
        assert!(d.join("mcp_config.json").exists());
    }

    #[test]
    fn test_delete_configurations_preserves_retired_local_data() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_configurations(d);

        assert!(exists_all(d, LEGACY_LOCAL_DATA_DIRS));
        assert!(!exists_any(d, BIYAN_DATA_FILES_CONFIGS));
        assert!(exists_all(d, BIYAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, BIYAN_DATA_DIRS_COMMON));
        assert!(d.join("settings.json").exists());
    }

    #[test]
    fn test_delete_common_data_only_removes_common_dirs() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_common_data(d);

        assert!(!exists_any(d, BIYAN_DATA_DIRS_COMMON));
        assert!(exists_all(d, BIYAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, LEGACY_LOCAL_DATA_DIRS));
        assert!(d.join("settings.json").exists());
        assert!(d.join("mcp_config.json").exists());
    }

    #[test]
    fn test_delete_settings_only_removes_settings_json() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_settings(d);

        assert!(!d.join("settings.json").exists());
        assert!(exists_all(d, BIYAN_DATA_DIRS_CONVERSATIONS));
        assert!(exists_all(d, LEGACY_LOCAL_DATA_DIRS));
        assert!(exists_all(d, BIYAN_DATA_DIRS_COMMON));
        assert!(d.join("mcp_config.json").exists());
    }

    #[test]
    fn test_settings_json_survives_when_keeping_any_category() {
        // Simulate: keep_app_data=true, keep_configurations=false
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_common_data(d);
        delete_configurations(d);
        // settings.json should NOT be deleted because keep_app_data=true
        assert!(d.join("settings.json").exists());

        // Simulate: keep_app_data=false, keep_configurations=true
        let tmp2 = tempdir().unwrap();
        let d2 = tmp2.path();
        create_all_data(d2);

        delete_common_data(d2);
        delete_conversations(d2);
        // settings.json should NOT be deleted because keep_configurations=true
        assert!(d2.join("settings.json").exists());
    }

    #[test]
    fn test_full_wipe_deletes_settings_json() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        create_all_data(d);

        delete_common_data(d);
        delete_conversations(d);
        delete_configurations(d);
        delete_settings(d);

        assert!(!d.join("settings.json").exists());
        assert!(!exists_any(d, BIYAN_DATA_SUBDIRS));
        assert!(!exists_any(d, BIYAN_DATA_FILES));
        assert!(exists_all(d, LEGACY_LOCAL_DATA_DIRS));
    }

    #[test]
    fn test_delete_on_nonexistent_dirs_does_not_panic() {
        let tmp = tempdir().unwrap();
        let d = tmp.path();
        // Nothing created — should not panic
        delete_conversations(d);
        delete_configurations(d);
        delete_common_data(d);
        delete_settings(d);
    }

    #[test]
    fn test_is_safe_to_delete() {
        assert!(!is_safe_to_delete(std::path::Path::new("/")));
        assert!(!is_safe_to_delete(std::path::Path::new("/home")));
        assert!(is_safe_to_delete(std::path::Path::new("/home/user/biyan")));
        assert!(is_safe_to_delete(std::path::Path::new(
            "/home/user/.local/share/biyan"
        )));
    }

    #[test]
    fn test_normalize_windows_explorer_path_strips_extended_prefixes() {
        assert_eq!(
            normalize_windows_explorer_path(Path::new(r"\\?\C:\Users\Owner\Pictures\a.png")),
            r"C:\Users\Owner\Pictures\a.png"
        );
        assert_eq!(
            normalize_windows_explorer_path(Path::new(r"\\?\UNC\server\share\a.png")),
            r"\\server\share\a.png"
        );
        assert_eq!(
            normalize_windows_explorer_path(Path::new(r"C:\Users\Owner\Pictures\a.png")),
            r"C:\Users\Owner\Pictures\a.png"
        );
    }

    #[test]
    fn test_spawn_file_manager_error_is_returned() {
        let result = spawn_file_manager(
            "__biyan_missing_file_manager_for_test__",
            std::iter::empty::<&str>(),
            "open file explorer",
        );

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Failed to open file explorer"));
    }

    #[test]
    fn test_windows_biyan_cli_bin_dir_uses_biyan_install_dir() {
        let local_app_data = PathBuf::from(r"C:\Users\Owner\AppData\Local");
        let bin_dir = biyan_cli_bin_dir_from_local_app_data(&local_app_data);

        assert_eq!(
            bin_dir,
            local_app_data
                .join("Programs")
                .join("Biyan")
                .join("resources")
                .join("bin")
        );
    }

    #[test]
    fn managed_legacy_cli_shim_is_removed_but_user_owned_binary_is_preserved() {
        let tmp = tempdir().unwrap();
        let source = tmp.path().join("biyan-source");
        let managed = tmp.path().join("managed-predecessor");
        fs::write(&source, b"remote-only-cli").unwrap();
        reconcile_managed_legacy_cli_shim_with_hashes(&source, &managed, &[]).unwrap();
        assert!(managed.is_file());
        assert!(cli_install_marker(&managed).is_file());
        remove_managed_legacy_cli_shim(&managed).unwrap();
        assert!(!managed.exists());
        assert!(!cli_install_marker(&managed).exists());

        let user_owned = tmp.path().join("user-owned-predecessor");
        fs::write(&user_owned, b"user-owned").unwrap();
        reconcile_managed_legacy_cli_shim_with_hashes(&source, &user_owned, &[]).unwrap();
        assert_eq!(fs::read(&user_owned).unwrap(), b"user-owned");
        remove_managed_legacy_cli_shim(&user_owned).unwrap();
        assert_eq!(fs::read(&user_owned).unwrap(), b"user-owned");
    }

    #[test]
    fn verified_markerless_0633_cli_is_taken_over_but_unknown_or_tampered_cli_is_preserved() {
        let tmp = tempdir().unwrap();
        let source = tmp.path().join("biyan-source");
        let known_legacy = tmp.path().join("known-legacy");
        fs::write(&source, b"remote-only-cli").unwrap();

        let interrupted_marker = tmp.path().join("interrupted-marker");
        fs::write(&interrupted_marker, b"remote-only-cli").unwrap();
        assert!(
            reconcile_managed_legacy_cli_shim_with_hashes(&source, &interrupted_marker, &[])
                .unwrap()
        );
        assert!(managed_cli_marker_matches_binary(&interrupted_marker));

        fs::write(&known_legacy, b"verified-0.6.633-cli").unwrap();
        let legacy_digest = sha256_file(&known_legacy).unwrap();

        assert!(reconcile_managed_legacy_cli_shim_with_hashes(
            &source,
            &known_legacy,
            &[legacy_digest.as_str()]
        )
        .unwrap());
        assert_eq!(fs::read(&known_legacy).unwrap(), b"remote-only-cli");
        assert!(managed_cli_marker_matches_binary(&known_legacy));

        let tampered = tmp.path().join("tampered");
        reconcile_cli_binary(&source, &tampered).unwrap();
        fs::write(&tampered, b"user-replaced-content").unwrap();
        assert!(!reconcile_managed_legacy_cli_shim_with_hashes(
            &source,
            &tampered,
            &[legacy_digest.as_str()]
        )
        .unwrap());
        assert_eq!(fs::read(&tampered).unwrap(), b"user-replaced-content");
    }

    #[test]
    fn readonly_cli_sources_and_stale_staging_remain_upgradeable() {
        let tmp = tempdir().unwrap();
        let source_v1 = tmp.path().join("biyan-source-v1");
        let source_v2 = tmp.path().join("biyan-source-v2");
        let destination = tmp.path().join("biyan-managed");
        let stale_staging = tmp
            .path()
            .join(format!(".biyan.installing-{}", std::process::id()));
        fs::write(&source_v1, b"remote-only-cli-v1").unwrap();
        fs::write(&source_v2, b"remote-only-cli-v2").unwrap();
        fs::write(&stale_staging, b"stale-partial-cli").unwrap();
        make_test_file_readonly(&source_v1);
        make_test_file_readonly(&source_v2);
        make_test_file_readonly(&stale_staging);

        reconcile_cli_binary(&source_v1, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"remote-only-cli-v1");
        assert!(managed_cli_marker_matches_binary(&destination));
        assert!(!stale_staging.exists());

        // Simulate a managed destination produced by an older build which
        // copied the bundle's read-only attribute onto the installed CLI.
        make_test_file_readonly(&destination);
        reconcile_cli_binary(&source_v2, &destination).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), b"remote-only-cli-v2");
        assert!(managed_cli_marker_matches_binary(&destination));
        assert!(!fs::metadata(&destination).unwrap().permissions().readonly());

        let marker: serde_json::Value =
            serde_json::from_slice(&fs::read(cli_install_marker(&destination)).unwrap()).unwrap();
        let source_v2_digest = sha256_file(&source_v2).unwrap();
        assert_eq!(
            marker.get("sha256").and_then(serde_json::Value::as_str),
            Some(source_v2_digest.as_str())
        );

        #[cfg(windows)]
        for path in [source_v1, source_v2] {
            make_test_file_writable(&path);
        }
    }

    #[cfg(windows)]
    #[test]
    fn failed_managed_cli_replace_restores_readonly_destination() {
        let tmp = tempdir().unwrap();
        let missing_staging = tmp.path().join("missing-staging");
        let destination = tmp.path().join("managed-cli");
        fs::write(&destination, b"existing-managed-cli").unwrap();
        make_test_file_readonly(&destination);

        let error = replace_managed_cli_atomically(&missing_staging, &destination).unwrap_err();

        assert!(error.contains("commit_tmp:"));
        assert_eq!(fs::read(&destination).unwrap(), b"existing-managed-cli");
        assert!(fs::metadata(&destination).unwrap().permissions().readonly());
        make_test_file_writable(&destination);
    }

    #[test]
    fn unix_multi_path_legacy_copies_are_taken_over_in_ab_and_removed_in_c() {
        let tmp = tempdir().unwrap();
        let home = tmp.path().join("home");
        let usr_local_bin = tmp.path().join("usr-local-bin");
        let candidates = legacy_unix_cli_candidates(&home, &usr_local_bin);
        for candidate in &candidates {
            fs::create_dir_all(candidate.parent().unwrap()).unwrap();
            fs::write(candidate, b"verified-0.6.633-cli").unwrap();
        }
        let legacy_digest = sha256_file(&candidates[0]).unwrap();
        let source = tmp.path().join("biyan-source");
        fs::write(&source, b"remote-only-cli").unwrap();

        reconcile_legacy_cli_locations_with_hashes(
            &source,
            &candidates[0],
            &candidates,
            true,
            &[legacy_digest.as_str()],
        )
        .unwrap();
        for candidate in &candidates {
            assert_eq!(fs::read(candidate).unwrap(), b"remote-only-cli");
            assert!(managed_cli_marker_matches_binary(candidate));
        }

        reconcile_legacy_cli_locations_with_hashes(
            &source,
            &candidates[0],
            &candidates,
            false,
            &[legacy_digest.as_str()],
        )
        .unwrap();
        for candidate in &candidates {
            assert!(!candidate.exists());
            assert!(!cli_install_marker(candidate).exists());
        }
    }

    #[test]
    fn windows_candidate_scan_covers_current_and_predecessor_resource_bins() {
        let local_app_data = PathBuf::from(r"C:\Users\Owner\AppData\Local");
        let candidates = legacy_windows_cli_candidates_from_local_app_data(&local_app_data);
        for product in ["Biyan", "Mita"] {
            let install = local_app_data.join("Programs").join(product);
            assert!(candidates.contains(&install.join("resources").join("bin").join("mita.exe")));
            assert!(
                candidates.contains(&install.join("resources").join("bin").join("mita-cli.exe"))
            );
            assert!(candidates.contains(&install.join("mita-cli.exe")));
        }
    }

    #[test]
    fn windows_path_puts_biyan_first_in_ab_and_removes_predecessor_entries_in_c() {
        let current = PathBuf::from(r"C:\Users\Owner\AppData\Local\Programs\Biyan\resources\bin");
        let old_root = r"C:\Users\Owner\AppData\Local\Programs\Mita";
        let old_bin = r"C:\Users\Owner\AppData\Local\Programs\Mita\resources\bin";
        let existing = format!(r"{old_bin};C:\Tools;{};{old_root}", current.display());

        let updated_ab = windows_user_path_with_biyan_first(&existing, &current, false);
        let parts: Vec<_> = updated_ab.split(';').collect();
        assert_eq!(
            windows_path_identity(parts[0]),
            windows_path_identity(&current.to_string_lossy())
        );
        assert!(parts.iter().any(|part| *part == r"C:\Tools"));
        assert!(parts
            .iter()
            .any(|part| windows_path_identity(part) == windows_path_identity(old_bin)));
        assert!(parts
            .iter()
            .any(|part| windows_path_identity(part) == windows_path_identity(old_root)));
        assert_eq!(
            parts
                .iter()
                .filter(|part| {
                    windows_path_identity(part) == windows_path_identity(&current.to_string_lossy())
                })
                .count(),
            1
        );

        let updated_c = windows_user_path_with_biyan_first(&existing, &current, true);
        let c_parts: Vec<_> = updated_c.split(';').collect();
        assert!(!c_parts
            .iter()
            .any(|part| windows_path_identity(part) == windows_path_identity(old_bin)));
        assert!(!c_parts
            .iter()
            .any(|part| windows_path_identity(part) == windows_path_identity(old_root)));
    }

    #[test]
    fn production_0633_cli_fingerprints_are_sha256_values() {
        assert_eq!(LEGACY_MANAGED_CLI_SHA256.len(), 2);
        assert!(LEGACY_MANAGED_CLI_SHA256.iter().all(|digest| {
            digest.len() == 64 && digest.bytes().all(|byte| byte.is_ascii_hexdigit())
        }));
    }
}
