use flate2::read::GzDecoder;
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Read,
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use tar::Archive;
use tauri::{App, Emitter, Manager, Runtime, WindowEvent, Wry};

#[cfg(feature = "desktop")]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_store::Store;

use crate::core::app::{commands::get_biyan_data_folder_path, constants::APP_NAME};
use crate::core::legacy_migrations::{
    mark_component_migration, mark_component_migration_failed, mark_component_migration_running,
};
use crate::core::mcp::constants::{
    default_web_research_mcp_config, BIYAN_WEB_RESEARCH_MCP_NAME, DEFAULT_MCP_CONFIG,
};
use crate::core::mcp::helpers::add_server_config;

use super::{
    extensions::commands::get_biyan_extensions_path, mcp::helpers::run_mcp_commands,
    state::AppState,
};

const EXTENSIONS_MIGRATION_STEP: &str = "extensions_manifest_v1";
const TARGET_EXTENSIONS_SCHEMA: u32 = 1;
const ALLOWED_BUNDLED_EXTENSION_IDS: &[&str] = &[
    "@biyan/assistant-extension",
    "@biyan/conversational-extension",
    "@biyan/download-extension",
];

pub fn is_allowed_bundled_extension_id(id: &str) -> bool {
    ALLOWED_BUNDLED_EXTENSION_IDS.contains(&id)
}

pub fn install_extensions<R: Runtime>(
    app: tauri::AppHandle<R>,
    _force: bool,
) -> Result<(), String> {
    // Skip extension installation on mobile platforms
    // Mobile uses pre-bundled extensions loaded via MobileCoreService in the frontend
    #[cfg(any(target_os = "android", target_os = "ios"))]
    {
        let config_dir = app
            .path()
            .data_dir()
            .map_err(|e| format!("resolve_extension_state_dir:{e}"))?
            .join(APP_NAME);
        // Mobile extensions are compiled into the application rather than
        // installed from archives. Treat that verified build contract as the
        // platform-specific completion of the same migration step.
        mark_component_migration_running(
            &config_dir,
            EXTENSIONS_MIGRATION_STEP,
            TARGET_EXTENSIONS_SCHEMA,
        )?;
        return mark_component_migration(
            &config_dir,
            EXTENSIONS_MIGRATION_STEP,
            TARGET_EXTENSIONS_SCHEMA,
        );
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        let config_dir = app
            .path()
            .data_dir()
            .map_err(|e| format!("resolve_extension_state_dir:{e}"))?
            .join(APP_NAME);
        mark_component_migration_running(
            &config_dir,
            EXTENSIONS_MIGRATION_STEP,
            TARGET_EXTENSIONS_SCHEMA,
        )?;

        let result = install_extensions_atomically(app);
        match result {
            Ok(()) => mark_component_migration(
                &config_dir,
                EXTENSIONS_MIGRATION_STEP,
                TARGET_EXTENSIONS_SCHEMA,
            ),
            Err(error) => {
                if let Err(marker_error) = mark_component_migration_failed(
                    &config_dir,
                    EXTENSIONS_MIGRATION_STEP,
                    TARGET_EXTENSIONS_SCHEMA,
                    &error,
                ) {
                    log::error!("Failed to persist extension migration failure: {marker_error}");
                }
                Err(error)
            }
        }
    }
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn install_extensions_atomically<R: Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let extensions_path = get_biyan_extensions_path(app.clone());
    let pre_install_path = app
        .path()
        .resource_dir()
        .map_err(|e| format!("resolve_extension_resources:{e}"))?
        .join("resources")
        .join("pre-install");

    let parent = extensions_path
        .parent()
        .ok_or_else(|| "extensions_path_missing_parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("create_extensions_parent:{e}"))?;
    let staging = parent.join(format!("extensions.staging-{}", std::process::id()));
    let backup = parent.join(format!("extensions.backup-{}", std::process::id()));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| format!("clean_extension_staging:{e}"))?;
    }
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|e| format!("clean_extension_backup:{e}"))?;
    }
    fs::create_dir_all(&staging).map_err(|e| format!("create_extension_staging:{e}"))?;

    let mut extensions = BTreeMap::<String, serde_json::Value>::new();

    if !pre_install_path.exists() {
        return Err("preinstall_extensions_missing".to_string());
    } else {
        for entry in fs::read_dir(&pre_install_path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();

            if path.extension().is_some_and(|ext| ext == "tgz") {
                let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
                let gz_decoder = GzDecoder::new(tar_gz);
                let mut archive = Archive::new(gz_decoder);

                let mut extension_name = None;
                let mut extension_manifest = None;
                extract_extension_manifest(&mut archive)
                    .map_err(|e| e.to_string())
                    .and_then(|manifest| match manifest {
                        Some(manifest) => {
                            extension_name = manifest["name"].as_str().map(|s| s.to_string());
                            extension_manifest = Some(manifest);
                            Ok(())
                        }
                        None => Err("Manifest is None".to_string()),
                    })?;

                let extension_name = extension_name.ok_or("package.json not found in archive")?;
                if !is_allowed_bundled_extension_id(&extension_name) {
                    return Err(format!("extension_id_not_allowed:{extension_name}"));
                }
                let extension_dir = staging.join(extension_name.clone());
                fs::create_dir_all(&extension_dir).map_err(|e| e.to_string())?;

                let tar_gz = File::open(&path).map_err(|e| e.to_string())?;
                let gz_decoder = GzDecoder::new(tar_gz);
                let mut archive = Archive::new(gz_decoder);
                for entry in archive.entries().map_err(|e| e.to_string())? {
                    let mut entry = entry.map_err(|e| e.to_string())?;
                    let entry_type = entry.header().entry_type();
                    if !(entry_type.is_file() || entry_type.is_dir()) {
                        return Err("extension_archive_unsupported_entry".to_string());
                    }
                    let file_path = entry.path().map_err(|e| e.to_string())?;
                    let components: Vec<_> = file_path.components().collect();
                    if !components.is_empty() {
                        let start = usize::from(matches!(
                            components.first(),
                            Some(Component::Normal(root)) if *root == std::ffi::OsStr::new("package")
                        ));
                        if start == components.len() {
                            continue;
                        }
                        let relative_path: PathBuf = components[start..].iter().collect();
                        if relative_path.components().any(|component| {
                            !matches!(component, Component::Normal(_) | Component::CurDir)
                        }) {
                            return Err("extension_archive_unsafe_path".to_string());
                        }
                        let target_path = extension_dir.join(relative_path);
                        if let Some(parent) = target_path.parent() {
                            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
                        }
                        let _result = entry.unpack(&target_path).map_err(|e| e.to_string())?;
                    }
                }

                let staged_manifest_path = extension_dir.join("package.json");
                let staged_manifest: serde_json::Value = serde_json::from_slice(
                    &fs::read(&staged_manifest_path)
                        .map_err(|e| format!("extension_manifest_missing:{extension_name}:{e}"))?,
                )
                .map_err(|e| format!("extension_manifest_invalid:{extension_name}:{e}"))?;
                if extension_manifest.as_ref() != Some(&staged_manifest) {
                    return Err(format!("extension_manifest_changed:{extension_name}"));
                }

                let main_entry = extension_manifest
                    .as_ref()
                    .and_then(|manifest| manifest["main"].as_str())
                    .unwrap_or("index.js");
                let main_path = Path::new(main_entry);
                if main_path.is_absolute()
                    || main_path.components().any(|component| {
                        !matches!(component, Component::Normal(_) | Component::CurDir)
                    })
                {
                    return Err(format!("extension_main_unsafe:{extension_name}"));
                }
                let staged_main = extension_dir.join(main_entry);
                if !staged_main.is_file() {
                    return Err(format!(
                        "extension_main_missing:{extension_name}:{main_entry}"
                    ));
                }
                let url = extensions_path
                    .join(&extension_name)
                    .join(main_entry)
                    .to_string_lossy()
                    .to_string();

                let new_extension = serde_json::json!({
                    "url": url,
                    "name": extension_name.clone(),
                    "origin": extensions_path.join(&extension_name).to_string_lossy(),
                    "active": true,
                    "description": extension_manifest
                        .as_ref()
                        .and_then(|manifest| manifest["description"].as_str())
                        .unwrap_or(""),
                    "version": extension_manifest
                        .as_ref()
                        .and_then(|manifest| manifest["version"].as_str())
                        .unwrap_or(""),
                    "productName": extension_manifest
                        .as_ref()
                        .and_then(|manifest| manifest["productName"].as_str())
                        .unwrap_or(""),
                });

                extensions.insert(extension_name.clone(), new_extension);

                log::info!("Installed extension to {extension_dir:?}");
            }
        }
    }

    for required_id in ALLOWED_BUNDLED_EXTENSION_IDS {
        if !extensions.contains_key(*required_id) {
            return Err(format!("required_extension_missing:{required_id}"));
        }
    }

    let extensions_list: Vec<_> = extensions.into_values().collect();
    let extensions_json_path = staging.join("extensions.json");
    fs::write(
        &extensions_json_path,
        serde_json::to_vec_pretty(&extensions_list).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("write_extension_registry:{e}"))?;

    if extensions_path.exists() {
        fs::rename(&extensions_path, &backup).map_err(|e| format!("backup_extensions:{e}"))?;
    }
    if let Err(error) = fs::rename(&staging, &extensions_path) {
        if backup.exists() {
            let _ = fs::rename(&backup, &extensions_path);
        }
        return Err(format!("commit_extensions:{error}"));
    }
    if backup.exists() {
        fs::remove_dir_all(&backup).map_err(|e| format!("remove_extension_backup:{e}"))?;
    }

    Ok(())
}

fn prepare_mcp_config_for_migration(config_path: &Path) -> Result<(), String> {
    let contents = match fs::read(config_path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return crate::core::legacy_migrations::atomic_write(
                config_path,
                DEFAULT_MCP_CONFIG.as_bytes(),
            )
            .map_err(|error| format!("mcp_config_create_default:{error}"));
        }
        Err(error) => return Err(format!("mcp_config_read:{error}")),
    };

    let config: serde_json::Value = serde_json::from_slice(&contents)
        .map_err(|error| format!("mcp_config_invalid_json:{error}"))?;
    let config = config
        .as_object()
        .ok_or_else(|| "mcp_config_root_not_object".to_string())?;
    if config
        .get("mcpServers")
        .is_some_and(|servers| !servers.is_object())
    {
        return Err("mcp_config_servers_not_object".to_string());
    }

    Ok(())
}

// Migrate MCP servers configuration
pub fn migrate_mcp_servers(
    app_handle: tauri::AppHandle,
    store: Arc<Store<Wry>>,
) -> Result<(), String> {
    const MCP_MIGRATION_STEP: &str = "mcp_names_v1";
    let config_dir = app_handle
        .path()
        .data_dir()
        .map_err(|error| format!("resolve_mcp_migration_state:{error}"))?
        .join(APP_NAME);
    mark_component_migration_running(&config_dir, MCP_MIGRATION_STEP, 1)?;

    let result: Result<(), String> = (|| -> Result<(), String> {
        let config_path = get_biyan_data_folder_path(app_handle.clone()).join("mcp_config.json");
        prepare_mcp_config_for_migration(&config_path)?;

        let mcp_version = store
            .get("mcp_version")
            .and_then(|v| v.as_i64())
            .unwrap_or(0);
        if mcp_version < 1 {
            log::info!("Migrating MCP schema version 1");
            add_server_config(
                app_handle.clone(),
                "exa".to_string(),
                serde_json::json!({
                  "command": "npx",
                  "args": ["-y", "exa-mcp-server"],
                  "env": { "EXA_API_KEY": "YOUR_EXA_API_KEY_HERE" },
                  "active": false
                }),
            )?;
        }
        if mcp_version < 2 {
            log::info!("Migrating MCP schema version 2: Adding Biyan Web Research");
            add_server_config(
                app_handle.clone(),
                BIYAN_WEB_RESEARCH_MCP_NAME.to_string(),
                default_web_research_mcp_config(),
            )?;
        }
        if mcp_version < 3 {
            log::info!("Migrating MCP schema version 3: Updating Exa to streamable HTTP");
            migrate_exa_to_http(app_handle.clone())?;
        }
        if mcp_version < 4 {
            log::info!("Migrating MCP schema version 4: Disabling bundled Exa MCP by default");
            disable_exa_mcp_by_default(app_handle.clone())?;
        }
        if mcp_version < 5 {
            log::info!(
                "Migrating MCP schema version 5: Replacing Browser MCP with Biyan Web Research"
            );
            migrate_browser_mcp_to_web_research(app_handle.clone())?;
        }
        store.set("mcp_version", 5);
        store
            .save()
            .map_err(|error| format!("Failed to persist MCP migration marker: {error}"))?;
        Ok(())
    })();

    match result {
        Ok(()) => mark_component_migration(&config_dir, MCP_MIGRATION_STEP, 1),
        Err(error) => {
            let _ = mark_component_migration_failed(&config_dir, MCP_MIGRATION_STEP, 1, &error);
            Err(error)
        }
    }
}

fn migrate_browser_mcp_to_web_research(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_biyan_data_folder_path(app_handle).join("mcp_config.json");
    if !config_path.exists() {
        return Ok(());
    }

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;
    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        crate::core::legacy_migrations::normalize_browser_mcp_server_key(servers);
    }

    crate::core::legacy_migrations::atomic_write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?
            .as_bytes(),
    )
    .map_err(|e| format!("Failed to write MCP config: {e}"))?;

    Ok(())
}

fn disable_exa_mcp_by_default(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_biyan_data_folder_path(app_handle).join("mcp_config.json");
    if !config_path.exists() {
        return Ok(());
    }

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;
    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    if let Some(exa) = config
        .get_mut("mcpServers")
        .and_then(|servers| servers.get_mut("exa"))
        .and_then(|exa| exa.as_object_mut())
    {
        exa.insert("active".to_string(), serde_json::json!(false));
    }

    crate::core::legacy_migrations::atomic_write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?
            .as_bytes(),
    )
    .map_err(|e| format!("Failed to write MCP config: {e}"))?;

    Ok(())
}

fn migrate_exa_to_http(app_handle: tauri::AppHandle) -> Result<(), String> {
    let config_path = get_biyan_data_folder_path(app_handle).join("mcp_config.json");

    let config_str =
        fs::read_to_string(&config_path).map_err(|e| format!("Failed to read MCP config: {e}"))?;

    let mut config: serde_json::Value = serde_json::from_str(&config_str)
        .map_err(|e| format!("Failed to parse MCP config: {e}"))?;

    if let Some(servers) = config.get_mut("mcpServers").and_then(|s| s.as_object_mut()) {
        servers.insert(
            "exa".to_string(),
            serde_json::json!({
                "type": "http",
                "url": "https://mcp.exa.ai/mcp".to_string(),
                "command": "",
                "args": [],
                "env": {},
                "active": false
            }),
        );
    }

    crate::core::legacy_migrations::atomic_write(
        &config_path,
        serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize MCP config: {e}"))?
            .as_bytes(),
    )
    .map_err(|e| format!("Failed to write MCP config: {e}"))?;

    Ok(())
}

pub fn extract_extension_manifest<R: Read>(
    archive: &mut Archive<R>,
) -> Result<Option<serde_json::Value>, String> {
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| format!("extension_archive_entry:{e}"))?;
        let file_path = entry
            .path()
            .map_err(|e| format!("extension_archive_path:{e}"))?;
        let path_str = file_path.to_string_lossy();
        if path_str != "package/package.json" && path_str != "package.json" {
            continue;
        }
        if entry
            .header()
            .size()
            .map_err(|e| format!("extension_manifest_size:{e}"))?
            > 1024 * 1024
        {
            return Err("extension_manifest_too_large".to_string());
        }
        let mut content = String::new();
        entry
            .read_to_string(&mut content)
            .map_err(|e| format!("read_extension_manifest:{e}"))?;
        let package_json: serde_json::Value =
            serde_json::from_str(&content).map_err(|e| format!("parse_extension_manifest:{e}"))?;
        return Ok(Some(package_json));
    }

    Ok(None)
}

/// Install/update the bundled `biyan` CLI before API and MCP startup.
pub fn setup_biyan_cli<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    _version_changed: bool,
) -> Result<(), String> {
    let status = crate::core::system::commands::install_biyan_cli_sync(&app_handle)?;
    log::info!(
        "biyan CLI reconciled by schema and digest at {}",
        status.path.as_deref().unwrap_or("<unknown>")
    );
    Ok(())
}

pub fn setup_mcp<R: Runtime>(app: &App<R>) {
    let state = app.state::<AppState>();
    let servers = state.mcp_servers.clone();
    let app_handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        use crate::core::mcp::lockfile::cleanup_all_stale_locks;

        let config_path = get_biyan_data_folder_path(app_handle.clone()).join("mcp_config.json");
        if let Err(error) = prepare_mcp_config_for_migration(&config_path) {
            log::error!("Failed to prepare MCP config: {error}");
            return;
        }

        if let Err(e) = cleanup_all_stale_locks(&app_handle).await {
            log::debug!("Lock file cleanup error: {}", e);
        }

        if let Err(e) = run_mcp_commands(&app_handle, servers).await {
            log::error!("Failed to run mcp commands: {e}");
        }
        app_handle
            .emit("mcp-update", "MCP servers updated")
            .unwrap();
    });
}

#[cfg(feature = "desktop")]
pub fn setup_tray(app: &App) -> tauri::Result<TrayIcon> {
    let show_i = MenuItem::with_id(app.handle(), "open", "Open Biyan", true, None::<&str>)?;
    let quit_i = MenuItem::with_id(app.handle(), "quit", "Quit", true, None::<&str>)?;
    let separator_i = PredefinedMenuItem::separator(app.handle())?;
    let menu = Menu::with_items(app.handle(), &[&show_i, &separator_i, &quit_i])?;
    TrayIconBuilder::with_id("tray")
        .icon(app.default_window_icon().unwrap().clone())
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => {
                // let's show and focus the main window when the tray is clicked
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            _ => {
                log::debug!("unhandled event {event:?}");
            }
        })
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => {
                let window = app.get_webview_window("main").unwrap();
                window.show().unwrap();
                window.set_focus().unwrap();
            }
            "quit" => {
                app.exit(0);
            }
            other => {
                println!("menu item {other} not handled");
            }
        })
        .build(app)
}

pub fn setup_theme_listener<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    // Setup GTK window theme listener for main window
    if let Some(window) = app.get_webview_window("main") {
        setup_window_theme_listener(app.handle().clone(), window);
    }

    // On Linux, also listen to XDG Desktop Portal color-scheme changes via D-Bus.
    // This is needed because KDE Plasma and some other desktop environments
    // don't always update GTK settings when the system theme changes,
    // which means the GTK WindowEvent::ThemeChanged may never fire.
    #[cfg(target_os = "linux")]
    {
        let app_handle = app.handle().clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = setup_xdg_portal_theme_listener(app_handle).await {
                log::warn!("Failed to setup XDG Desktop Portal theme listener: {e}");
                log::warn!("System theme changes from KDE/non-GNOME DEs may not be detected");
            }
        });
    }

    Ok(())
}

/// Listen to the XDG Desktop Portal `org.freedesktop.appearance` `color-scheme`
/// setting via D-Bus. This fires reliably on KDE Plasma, GNOME, and other
/// freedesktop-compliant desktop environments.
#[cfg(target_os = "linux")]
async fn setup_xdg_portal_theme_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
) -> Result<(), Box<dyn std::error::Error>> {
    use futures_util::StreamExt;
    use zbus::Connection;

    let connection = Connection::session().await?;

    // Build a proxy for the XDG Desktop Portal Settings interface
    let proxy: zbus::Proxy<'_> = zbus::proxy::Builder::new(&connection)
        .destination("org.freedesktop.portal.Desktop")?
        .path("/org/freedesktop/portal/desktop")?
        .interface("org.freedesktop.portal.Settings")?
        .build()
        .await?;

    // Listen for all SettingChanged signals and filter for color-scheme
    let mut signal_stream = proxy.receive_signal("SettingChanged").await?;

    log::info!("XDG Desktop Portal theme listener active");

    while let Some(signal) = signal_stream.next().await {
        let body = signal.body();
        if let Ok((namespace, key, value)) =
            body.deserialize::<(String, String, zbus::zvariant::OwnedValue)>()
        {
            if namespace == "org.freedesktop.appearance" && key == "color-scheme" {
                // color-scheme values: 0 = no preference, 1 = prefer dark, 2 = prefer light
                let color_scheme = u32::try_from(value).unwrap_or(0);
                let theme_str = match color_scheme {
                    1 => "dark",
                    2 => "light",
                    _ => "light", // default to light for "no preference"
                };
                log::info!(
                    "XDG Portal: system color-scheme changed to: {theme_str} (raw value: {color_scheme})"
                );
                let _ = app_handle.emit("theme-changed", theme_str);
            }
        }
    }

    Ok(())
}

fn setup_window_theme_listener<R: Runtime>(
    app_handle: tauri::AppHandle<R>,
    window: tauri::WebviewWindow<R>,
) {
    let window_label = window.label().to_string();
    let app_handle_clone = app_handle.clone();

    window.on_window_event(move |event| {
        if let WindowEvent::ThemeChanged(theme) = event {
            let theme_str = match theme {
                tauri::Theme::Light => "light",
                tauri::Theme::Dark => "dark",
                _ => "auto",
            };
            log::info!("System theme changed to: {theme_str} for window: {window_label}");
            let _ = app_handle_clone.emit("theme-changed", theme_str);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn missing_mcp_config_is_created_atomically() {
        let temp = TempDir::new().unwrap();
        let config_path = temp.path().join("nested").join("mcp_config.json");

        prepare_mcp_config_for_migration(&config_path).unwrap();

        assert_eq!(
            fs::read_to_string(&config_path).unwrap(),
            DEFAULT_MCP_CONFIG
        );
        let parent = config_path.parent().unwrap();
        assert!(
            fs::read_dir(parent)
                .unwrap()
                .filter_map(Result::ok)
                .all(|entry| !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".mcp_config.json.")),
            "atomic MCP config creation must not leave a temporary file"
        );
    }

    #[test]
    fn existing_mcp_config_is_not_rewritten() {
        let temp = TempDir::new().unwrap();
        let config_path = temp.path().join("mcp_config.json");
        let custom_config = br#"{
  "customTopLevel": "keep-this-value",
  "mcpServers": {
    "Private MCP": {
      "command": "private-mcp",
      "env": {"PRIVATE_TOKEN": "keep-this-secret"},
      "active": true
    }
  }
}
"#;
        fs::write(&config_path, custom_config).unwrap();

        prepare_mcp_config_for_migration(&config_path).unwrap();

        assert_eq!(fs::read(&config_path).unwrap(), custom_config);
    }

    #[test]
    fn invalid_json_mcp_config_fails_closed_without_replacement() {
        let temp = TempDir::new().unwrap();
        let config_path = temp.path().join("mcp_config.json");
        let malformed = br#"{"mcpServers":{"Private MCP":"#;
        fs::write(&config_path, malformed).unwrap();

        let error = prepare_mcp_config_for_migration(&config_path).unwrap_err();

        assert!(error.starts_with("mcp_config_invalid_json:"));
        assert_eq!(fs::read(&config_path).unwrap(), malformed);
    }

    #[test]
    fn invalid_mcp_config_structure_fails_closed_without_replacement() {
        let temp = TempDir::new().unwrap();
        let config_path = temp.path().join("mcp_config.json");
        for (contents, expected_error) in [
            (
                br#"["not", "an", "object"]"#.as_slice(),
                "mcp_config_root_not_object",
            ),
            (
                br#"{"mcpServers":["not","an","object"]}"#.as_slice(),
                "mcp_config_servers_not_object",
            ),
        ] {
            fs::write(&config_path, contents).unwrap();

            let error = prepare_mcp_config_for_migration(&config_path).unwrap_err();

            assert_eq!(error, expected_error);
            assert_eq!(fs::read(&config_path).unwrap(), contents);
        }
    }
}
