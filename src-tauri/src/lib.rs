pub mod core;

#[cfg(not(feature = "cli"))]
use biyan_utils::generate_app_token;
#[cfg(not(feature = "cli"))]
use core::{
    app::commands::get_biyan_data_folder_path,
    downloads::models::DownloadManagerState,
    mcp::models::McpSettings,
    setup::{self, setup_mcp},
    state::AppState,
};
#[cfg(not(feature = "cli"))]
use std::{collections::HashMap, sync::Arc};
#[cfg(not(feature = "cli"))]
use tauri::{Emitter, Manager, RunEvent};
#[cfg(not(feature = "cli"))]
use tauri_plugin_store::StoreExt;
#[cfg(not(feature = "cli"))]
use tokio::sync::Mutex;

#[cfg(all(not(feature = "cli"), windows))]
const WINDOWS_BIYAN_MIGRATED_KEY: &str = "windows_biyan_migrated";
#[cfg(all(not(feature = "cli"), windows))]
const WINDOWS_BIYAN_HEALTHY_STARTS_KEY: &str = "windows_biyan_healthy_starts";

#[cfg(not(feature = "cli"))]
fn navigate_main_window<R: tauri::Runtime>(
    app: &tauri::App<R>,
    destination: &str,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main_window_missing".to_string())?;
    let destination = serde_json::to_string(destination)
        .map_err(|error| format!("serialize_window_destination:{error}"))?;
    window
        .eval(format!("window.location.replace({destination})"))
        .map_err(|error| format!("navigate_main_window:{error}"))?;
    window
        .show()
        .map_err(|error| format!("show_main_window:{error}"))
}

#[cfg(not(feature = "cli"))]
fn show_migration_recovery<R: tauri::Runtime>(app: &tauri::App<R>, error: &str) {
    let code = error
        .split(':')
        .next()
        .unwrap_or("migration_failed")
        .chars()
        .filter(|value| value.is_ascii_alphanumeric() || *value == '_' || *value == '-')
        .collect::<String>();
    let destination = format!("/migration-recovery.html?error={code}");
    if let Err(navigation_error) = navigate_main_window(app, &destination) {
        eprintln!("Failed to open Biyan migration recovery page: {navigation_error}");
    }
}

#[cfg(not(feature = "cli"))]
macro_rules! invoke_commands_with_extras {
    ($($extra:path),* $(,)?) => {
        tauri::generate_handler![
        // FS commands - Deperecate soon
        core::filesystem::commands::join_path,
        core::filesystem::commands::mkdir,
        core::filesystem::commands::exists_sync,
        core::filesystem::commands::readdir_sync,
        core::filesystem::commands::read_file_sync,
        core::filesystem::commands::rm,
        core::filesystem::commands::mv,
        core::filesystem::commands::copy_file,
        core::filesystem::commands::file_stat,
        core::filesystem::commands::write_file_sync,
        core::filesystem::commands::write_yaml,
        core::filesystem::commands::read_yaml,
        core::filesystem::commands::decompress,
        core::filesystem::commands::open_dialog,
        core::filesystem::commands::save_dialog,
        // Image asset library
        core::image_assets::commands::save_image_asset,
        core::image_assets::commands::import_image_asset,
        core::image_assets::commands::list_image_assets,
        core::image_assets::commands::delete_image_asset,
        core::image_assets::commands::update_image_asset_project,
        core::video_assets::commands::save_video_asset,
        core::video_assets::commands::save_video_asset_from_url,
        core::video_assets::commands::list_video_assets,
        core::video_assets::commands::delete_video_asset,
        core::video_assets::commands::update_video_asset_project,
        core::media_upload::commands::upload_video_reference_media,
        // Novel mode persistence
        core::novels::commands::list_novel_projects,
        core::novels::commands::create_novel_project,
        core::novels::commands::open_novel_project,
        core::novels::commands::save_novel_project,
        core::novels::commands::delete_novel_project,
        core::novels::commands::load_manuscript_unit,
        core::novels::commands::save_manuscript_unit,
        core::novels::commands::save_novel_characters,
        core::novels::commands::save_novel_relationships,
        core::novels::commands::save_novel_outline,
        core::novels::commands::save_novel_clues,
        core::novels::commands::save_novel_comments,
        core::novels::commands::save_novel_suggestions,
        core::novels::commands::import_novel_project,
        core::novels::commands::export_novel_project,
        core::novels::commands::list_novel_revisions,
        core::novels::commands::restore_novel_revision,
        // Computer Agent commands
        core::computer_agent::commands::get_computer_agent_shell_status,
        core::computer_agent::commands::get_computer_agent_workspace_path,
        core::computer_agent::commands::validate_computer_agent_allowed_root,
        // App configuration commands
        core::app::commands::get_app_configurations,
        core::app::commands::get_user_home_path,
        core::app::commands::update_app_configuration,
        core::app::commands::get_biyan_data_folder_path,
        core::app::commands::get_configuration_file_path,
        core::app::commands::default_data_folder_path,
        core::app::commands::change_app_data_folder,
        core::app::commands::app_token,
        // Explicit, integrity-gated cleanup of user-owned retired local data
        core::legacy_migrations::inspect_legacy_local_data,
        core::legacy_migrations::cleanup_legacy_local_data,
        core::legacy_migrations::list_retained_legacy_migration_sources,
        core::legacy_migrations::get_committed_assistant_id_map,
        // Extension commands
        core::extensions::commands::get_biyan_extensions_path,
        core::extensions::commands::install_extensions,
        core::extensions::commands::get_active_extensions,
        // System commands
        core::system::commands::relaunch,
        core::system::commands::open_app_directory,
        core::system::commands::open_legacy_migration_source,
        core::system::commands::open_file_explorer,
        core::system::commands::factory_reset,
        core::system::commands::read_logs,
        core::user_logs::write_user_log,
        core::user_logs::read_user_logs,
        core::user_logs::clear_user_logs,
        core::user_logs::get_user_logs_directory,
        core::system::commands::launch_claude_code_with_config,
        core::system::commands::check_biyan_cli_installed,
        core::system::commands::install_biyan_cli,
        core::system::commands::uninstall_biyan_cli,
        core::system::commands::clear_claude_code_env,
        // Server commands
        core::server::commands::start_server,
        core::server::commands::stop_server,
        core::server::commands::get_server_status,
        // Remote provider commands
        core::server::remote_provider_commands::register_provider_config,
        core::server::remote_provider_commands::unregister_provider_config,
        core::server::remote_provider_commands::get_provider_config,
        core::server::remote_provider_commands::list_provider_configs,
        // MCP commands
        core::mcp::commands::get_tools,
        core::mcp::commands::get_tools_for_servers,
        core::mcp::commands::get_server_summaries,
        core::mcp::commands::call_tool,
        core::mcp::commands::cancel_tool_call,
        core::mcp::commands::restart_mcp_servers,
        core::mcp::commands::get_connected_servers,
        core::mcp::commands::save_mcp_configs,
        core::mcp::commands::get_mcp_configs,
        core::mcp::commands::activate_mcp_server,
        core::mcp::commands::deactivate_mcp_server,
        core::mcp::commands::check_biyan_web_research_connected,
        // Threads
        core::threads::commands::list_threads,
        core::threads::commands::create_thread,
        core::threads::commands::modify_thread,
        core::threads::commands::delete_thread,
        core::threads::commands::list_messages,
        core::threads::commands::create_message,
        core::threads::commands::modify_message,
        core::threads::commands::delete_message,
        core::threads::commands::get_thread_assistant,
        core::threads::commands::create_thread_assistant,
        core::threads::commands::modify_thread_assistant,
        // Download
        core::downloads::commands::download_files,
        core::downloads::commands::cancel_download_task,
        $(
            $extra,
        )*
    ]
    };
}

#[cfg(not(feature = "cli"))]
#[cfg_attr(
    all(mobile, any(target_os = "android", target_os = "ios")),
    tauri::mobile_entry_point
)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|_app, argv, _cwd| {
          println!("a new app instance was opened with {argv:?} and the deep link event was already triggered");
          // when defining deep link schemes at runtime, you must also check `argv` here
        }));
    }

    let mut app_builder = builder
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_document_parser::init());

    #[cfg(feature = "deep-link")]
    {
        app_builder = app_builder.plugin(tauri_plugin_deep_link::init());
    }

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        app_builder = app_builder.plugin(tauri_plugin_hardware::init());
    }

    // Desktop: include updater commands
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let app_builder = app_builder.invoke_handler(invoke_commands_with_extras![
        // Custom updater commands (desktop only)
        core::updater::commands::get_app_update_request_headers,
        core::updater::commands::record_pending_update_manifest,
    ]);

    // Mobile: no updater commands
    #[cfg(any(target_os = "android", target_os = "ios"))]
    let app_builder = app_builder.invoke_handler(invoke_commands_with_extras![
        // Mobile-specific remote provider commands
        core::server::remote_provider_commands::abort_remote_stream,
    ]);

    let app = app_builder
        .manage(AppState {
            app_token: Some(generate_app_token()),
            mcp_servers: Arc::new(Mutex::new(HashMap::new())),
            download_manager: Arc::new(Mutex::new(DownloadManagerState::default())),
            mcp_active_servers: Arc::new(Mutex::new(HashMap::new())),
            server_handle: Arc::new(Mutex::new(None)),
            tool_call_cancellations: Arc::new(Mutex::new(HashMap::new())),
            mcp_settings: Arc::new(Mutex::new(McpSettings::default())),
            mcp_shutdown_in_progress: Arc::new(Mutex::new(false)),
            mcp_monitoring_tasks: Arc::new(Mutex::new(HashMap::new())),
            background_cleanup_handle: Arc::new(Mutex::new(None)),
            mcp_server_pids: Arc::new(Mutex::new(HashMap::new())),
            provider_configs: Arc::new(Mutex::new(HashMap::new())),
            mcp_reconnect_notify: Arc::new(tokio::sync::Notify::new()),
        })
        .setup(|app| {
            let migration_report =
                match core::legacy_migrations::run_startup_migrations(app.handle()) {
                    Ok(report) => report,
                    Err(error) => {
                        eprintln!("Biyan data migration could not complete safely: {error}");
                        // Keep the legacy source untouched and do not continue into the normal
                        // data providers, which could otherwise mask the failure with an empty
                        // profile. The recovery page only exposes retry, logs and the read-only
                        // legacy source directory.
                        show_migration_recovery(app, &error);
                        return Ok(());
                    }
                };
            log::info!(
                "Biyan migration target schema {} selected (schema {} committed before component reconcile); {} legacy source(s) retained",
                migration_report.target_data_schema,
                migration_report.completed_data_schema,
                migration_report.retained_legacy_sources.len()
            );

            // Mobile storage is part of the migration transaction. Do not expose the normal
            // application window until the legacy SQLite backup has passed quick_check and the
            // canonical database is ready.
            #[cfg(any(target_os = "android", target_os = "ios"))]
            if let Err(error) = tauri::async_runtime::block_on(
                crate::core::threads::db::init_database(app.handle()),
            ) {
                log::error!("Failed to initialize migrated mobile database: {error}");
                show_migration_recovery(app, &error);
                return Ok(());
            }

            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let Err(error) = core::legacy_migrations::mark_component_migration(
                &migration_report.canonical_config_dir,
                "mobile_db_v1",
                1,
            ) {
                show_migration_recovery(app, &error);
                return Ok(());
            }

            let user_log_dir = core::user_logs::resolve_user_logs_directory(app.handle())
                .unwrap_or_else(|err| {
                    eprintln!(
                        "Failed to resolve platform logs directory, falling back to data folder logs: {err}"
                    );
                    get_biyan_data_folder_path(app.handle().clone()).join("logs")
                });
            if let Err(err) = core::user_logs::prune_user_log_files(&user_log_dir) {
                eprintln!("Failed to prune Biyan local logs during startup: {err}");
            }
            let app_version = app.config().version.clone().unwrap_or_default();
            let platform = std::env::consts::OS.to_string();
            if let Err(error) = app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Debug)
                    .targets([
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                        tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Dispatch(
                            core::user_logs::fern_dispatch_for_user_logs(
                                user_log_dir,
                                app_version,
                                platform,
                            ),
                        )),
                    ])
                    .build(),
            ) {
                let error = format!("log_plugin_init:{error}");
                eprintln!("Failed to initialize Biyan logging: {error}");
                show_migration_recovery(app, &error);
                return Ok(());
            }
            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            if let Err(error) = app
                .handle()
                .plugin(tauri_plugin_updater::Builder::new().build())
            {
                let error = format!("updater_plugin_init:{error}");
                log::error!("Failed to initialize the Biyan updater: {error}");
                show_migration_recovery(app, &error);
                return Ok(());
            }

            // Start migration
            let mut store_path = get_biyan_data_folder_path(app.handle().clone());
            store_path.push("store.json");
            let store = match app.handle().store(store_path) {
                Ok(store) => store,
                Err(error) => {
                    let error = format!("store_open:{error}");
                    log::error!("Failed to open the Biyan application store: {error}");
                    show_migration_recovery(app, &error);
                    return Ok(());
                }
            };
            let stored_version = store
                .get("version")
                .and_then(|v| v.as_str().map(String::from))
                .unwrap_or_default();
            let app_version = app.config().version.clone().unwrap_or_default();

            // Reconcile cumulative components in the fixed startup order:
            // layout -> mobile DB -> extensions -> CLI -> assistants -> MCP.
            if let Err(error) =
                setup::install_extensions(app.handle().clone(), stored_version != app_version)
            {
                log::error!("Failed to install extensions: {error}");
                show_migration_recovery(app, &error);
                return Ok(());
            }

            if let Err(error) = core::legacy_migrations::mark_component_migration_running(
                &migration_report.canonical_config_dir,
                "cli_v1",
                1,
            ) {
                show_migration_recovery(app, &error);
                return Ok(());
            }
            let cli_result: Result<(), String> = {
                #[cfg(desktop)]
                {
                    setup::setup_biyan_cli(
                        app.handle().clone(),
                        stored_version != app_version,
                    )
                }
                #[cfg(not(desktop))]
                {
                    Ok(())
                }
            };
            if let Err(error) = cli_result {
                let _ = core::legacy_migrations::mark_component_migration_failed(
                    &migration_report.canonical_config_dir,
                    "cli_v1",
                    1,
                    &error,
                );
                show_migration_recovery(app, &error);
                return Ok(());
            }
            if let Err(error) = core::legacy_migrations::mark_component_migration(
                &migration_report.canonical_config_dir,
                "cli_v1",
                1,
            ) {
                show_migration_recovery(app, &error);
                return Ok(());
            }

            if let Err(error) = core::legacy_migrations::complete_assistant_migration(
                &migration_report.canonical_config_dir,
                &migration_report.canonical_data_dir,
            ) {
                show_migration_recovery(app, &error);
                return Ok(());
            }

            #[cfg(any(target_os = "android", target_os = "ios"))]
            if let Err(error) = tauri::async_runtime::block_on(
                crate::core::threads::db::reconcile_mobile_assistant_references(app.handle()),
            ) {
                show_migration_recovery(app, &error);
                return Ok(());
            }
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            if let Err(error) = core::legacy_migrations::mark_component_migration(
                &migration_report.canonical_config_dir,
                "assistant_db_refs_v1",
                1,
            ) {
                show_migration_recovery(app, &error);
                return Ok(());
            }

            if let Err(error) = setup::migrate_mcp_servers(app.handle().clone(), store.clone()) {
                log::error!("Failed to migrate MCP servers: {error}");
                show_migration_recovery(app, &error);
                return Ok(());
            }

            if let Err(error) = core::legacy_migrations::finalize_remote_only_migration(
                &migration_report.canonical_config_dir,
                migration_report.target_data_schema,
            ) {
                show_migration_recovery(app, &error);
                return Ok(());
            }

            if migration_report.target_data_schema
                >= core::legacy_migrations::TARGET_DATA_SCHEMA
            {
                if let Err(error) = core::legacy_migrations::mark_component_migration(
                    &migration_report.canonical_config_dir,
                    "cleanup_v3",
                    core::legacy_migrations::TARGET_DATA_SCHEMA,
                ) {
                    show_migration_recovery(app, &error);
                    return Ok(());
                }

                #[cfg(windows)]
                {
                    let healthy_starts = store
                        .get(WINDOWS_BIYAN_HEALTHY_STARTS_KEY)
                        .and_then(|value| value.as_u64())
                        .unwrap_or(0)
                        .saturating_add(1);
                    store.set(
                        WINDOWS_BIYAN_HEALTHY_STARTS_KEY,
                        serde_json::json!(healthy_starts),
                    );
                    let windows_biyan_migrated = store
                        .get(WINDOWS_BIYAN_MIGRATED_KEY)
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false);
                    // Never remove the managed legacy installation until the canonical data,
                    // extensions and MCP configuration have survived two successful starts.
                    if healthy_starts >= 2 && !windows_biyan_migrated {
                        let store = store.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            match core::windows_migration::run_biyan_windows_migration() {
                                Ok(()) => {
                                    store.set(
                                        WINDOWS_BIYAN_MIGRATED_KEY,
                                        serde_json::json!(true),
                                    );
                                    if let Err(error) = store.save() {
                                        log::warn!(
                                            "Failed to persist Biyan Windows migration marker: {error}"
                                        );
                                    }
                                }
                                Err(error) => log::warn!(
                                    "Failed to complete Biyan Windows migration self-heal: {error}"
                                ),
                            }
                        });
                    }
                }
            }

            // Store the new app version
            store.set("version", serde_json::json!(app_version));
            if let Err(error) = store.save() {
                let error = format!("store_save:{error}");
                log::error!("Failed to save the Biyan application store: {error}");
                show_migration_recovery(app, &error);
                return Ok(());
            }
            // Migration completed

            #[cfg(feature = "desktop")]
            if option_env!("ENABLE_SYSTEM_TRAY_ICON").unwrap_or("false") == "true" {
                log::info!("Enabling system tray icon");
                let _ = setup::setup_tray(app);
            }

            #[cfg(all(feature = "deep-link", any(windows, target_os = "linux")))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                if let Err(error) = app.deep_link().register_all() {
                    #[cfg(debug_assertions)]
                    log::warn!("Failed to register deep links during dev startup: {error}");
                    #[cfg(not(debug_assertions))]
                    {
                        let error = format!("deep_link_registration:{error}");
                        log::error!("Failed to register Biyan deep links: {error}");
                        show_migration_recovery(app, &error);
                        return Ok(());
                    }
                }
            }

            setup_mcp(app);
            if let Err(error) = setup::setup_theme_listener(app) {
                let error = format!("theme_listener_init:{error}");
                log::error!("Failed to initialize the Biyan theme listener: {error}");
                show_migration_recovery(app, &error);
                return Ok(());
            }
            if let Err(error) = navigate_main_window(app, "/") {
                show_migration_recovery(app, &error);
                return Ok(());
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application");
    // Handle app lifecycle events
    app.run(|app, event| {
        if let RunEvent::Exit = event {
            let app_handle = app.clone();

            #[cfg(not(any(target_os = "ios", target_os = "android")))]
            {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.emit("app-shutting-down", ());
                    let _ = window.hide();
                }
            }

            let state = app_handle.state::<AppState>();

            // Check if cleanup already ran
            let cleanup_already_running = tokio::task::block_in_place(|| {
                tauri::async_runtime::block_on(async {
                    let handle = state.background_cleanup_handle.lock().await;
                    handle.is_some()
                })
            });

            if cleanup_already_running {
                return;
            }

            // Run cleanup synchronously and WAIT for it to complete
            tokio::task::block_in_place(|| {
                tauri::async_runtime::block_on(async {
                    use crate::core::mcp::helpers::background_cleanup_mcp_servers;
                    let state = app_handle.state::<AppState>();

                    // Increase timeout to 10 seconds and log if it times out
                    let cleanup_future = background_cleanup_mcp_servers(&app_handle, &state);
                    match tokio::time::timeout(tokio::time::Duration::from_secs(10), cleanup_future)
                        .await
                    {
                        Ok(_) => log::info!("MCP cleanup completed successfully"),
                        Err(_) => log::warn!("MCP cleanup timed out after 10 seconds"),
                    }

                    log::info!("App cleanup completed");
                });
            });
        }
    });
}
