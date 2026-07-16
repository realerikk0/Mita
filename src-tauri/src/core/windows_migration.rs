use std::{
    fs, io,
    path::{Path, PathBuf},
};

const LEGACY_PRODUCT_NAME: &str = "Mita";
#[cfg(any(windows, test))]
const DATA_LAYOUT_NAMES: &[&str] = &[
    "Biyan",
    "Mita",
    "Silence",
    "Jan",
    "uk.jingxing.mita",
    "uk.jingxing.silence",
    "jan.ai.app",
];
#[cfg(any(windows, test))]
const LEGACY_MAIN_BINARY_NAMES: &[&str] = &[
    // Keep in sync with the legacy Windows installer MAINBINARYNAME. Windows path lookups are
    // case-insensitive, but both spellings make tests and future audits explicit.
    "Biyan.exe",
    "Mita.exe",
    "mita.exe",
];
#[cfg(any(windows, test))]
const LEGACY_MANAGED_INSTALL_FILES: &[&str] = &[
    "Biyan.exe",
    "Mita.exe",
    "mita.exe",
    "mita-cli.exe",
    "mita-computer-agent-runner.exe",
    "bun.exe",
    "uv.exe",
    "uninstall.exe",
];

pub fn legacy_shortcut_paths(
    appdata: PathBuf,
    desktop: PathBuf,
    programs: PathBuf,
) -> Vec<PathBuf> {
    vec![
        desktop.join(format!("{LEGACY_PRODUCT_NAME}.lnk")),
        programs.join(format!("{LEGACY_PRODUCT_NAME}.lnk")),
        appdata
            .join("Microsoft")
            .join("Internet Explorer")
            .join("Quick Launch")
            .join("User Pinned")
            .join("TaskBar")
            .join(format!("{LEGACY_PRODUCT_NAME}.lnk")),
        appdata
            .join("Microsoft")
            .join("Internet Explorer")
            .join("Quick Launch")
            .join("User Pinned")
            .join("StartMenu")
            .join(format!("{LEGACY_PRODUCT_NAME}.lnk")),
    ]
}

pub fn legacy_install_candidates(local_app_data: PathBuf) -> Vec<PathBuf> {
    vec![local_app_data.join("Programs").join(LEGACY_PRODUCT_NAME)]
}

pub fn should_remove_legacy_install_dir(legacy_dir: &Path, current_exe: &Path) -> bool {
    let Some(legacy_dir) = install_dir_identity(legacy_dir) else {
        return false;
    };
    let Some(current_parent) = current_exe_parent_identity(current_exe) else {
        return false;
    };

    legacy_dir != current_parent
}

fn install_dir_identity(path: &Path) -> Option<String> {
    fs::canonicalize(path)
        .ok()
        .and_then(|canonical| lexical_path_identity(&canonical))
        .or_else(|| lexical_path_identity(path))
}

fn current_exe_parent_identity(current_exe: &Path) -> Option<String> {
    if let Ok(canonical_exe) = fs::canonicalize(current_exe) {
        return canonical_exe.parent().and_then(lexical_path_identity);
    }

    let current_exe = lexical_path_identity(current_exe)?;
    let (current_parent, _) = current_exe.rsplit_once('/')?;
    if current_parent.is_empty() {
        return None;
    }

    Some(current_parent.to_string())
}

fn lexical_path_identity(path: &Path) -> Option<String> {
    let normalized = path.to_string_lossy().replace('\\', "/");
    let normalized = normalized
        .strip_prefix("//?/UNC/")
        .map(|path| format!("//{path}"))
        .or_else(|| {
            normalized
                .strip_prefix("//?/")
                .map(std::string::ToString::to_string)
        })
        .unwrap_or(normalized);
    let normalized =
        collapse_lexical_segments(normalized.trim_end_matches('/')).to_ascii_lowercase();

    if !normalized.contains('/') {
        return None;
    }

    Some(normalized)
}

fn collapse_lexical_segments(path: &str) -> String {
    let prefix = if path.starts_with("//") {
        "//"
    } else if path.starts_with('/') {
        "/"
    } else {
        ""
    };
    let mut segments = Vec::new();
    let mut minimum_depth = if prefix == "//" { 2 } else { 0 };
    for segment in path.trim_start_matches('/').split('/') {
        match segment {
            "" | "." => {}
            ".." if segments.len() > minimum_depth
                && segments.last().is_some_and(|previous| *previous != "..") =>
            {
                segments.pop();
            }
            ".." if prefix.is_empty() => segments.push(segment),
            ".." => {}
            _ => {
                segments.push(segment);
                if segments.len() == 1 && segment.ends_with(':') {
                    minimum_depth = 1;
                }
            }
        }
    }
    format!("{prefix}{}", segments.join("/"))
}

#[cfg(any(windows, test))]
fn path_identity(path: &Path) -> Option<String> {
    fs::canonicalize(path)
        .ok()
        .and_then(|canonical| lexical_path_identity(&canonical))
        .or_else(|| lexical_path_identity(path))
}

#[cfg(any(windows, test))]
fn same_or_descendant_path(path: &Path, ancestor: &Path) -> bool {
    let Some(path) = path_identity(path) else {
        return false;
    };
    let Some(ancestor) = path_identity(ancestor) else {
        return false;
    };

    path == ancestor
        || path
            .strip_prefix(&ancestor)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

#[cfg(any(windows, test))]
fn configured_data_folders(config_roots: &[PathBuf]) -> io::Result<Vec<PathBuf>> {
    let mut folders = Vec::new();
    for config_root in config_roots {
        for name in DATA_LAYOUT_NAMES {
            let product_root = config_root.join(name);
            folders.push(product_root.join("data"));

            let config_path = product_root.join("settings.json");
            match fs::metadata(&config_path) {
                Ok(metadata) if metadata.is_file() => {}
                Ok(_) => {
                    return Err(io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!(
                            "data-folder configuration is not a regular file at {}; refusing predecessor cleanup",
                            config_path.display()
                        ),
                    ));
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(io::Error::new(
                        error.kind(),
                        format!(
                            "cannot inspect data-folder configuration at {}: {error}",
                            config_path.display()
                        ),
                    ));
                }
            }
            let raw = fs::read_to_string(&config_path).map_err(|error| {
                io::Error::new(
                    error.kind(),
                    format!(
                        "cannot inspect configured data folder in {}: {error}",
                        config_path.display()
                    ),
                )
            })?;
            let value: serde_json::Value = serde_json::from_str(&raw).map_err(|error| {
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "invalid data-folder configuration in {}: {error}",
                        config_path.display()
                    ),
                )
            })?;
            let configured = value
                .get("data_folder")
                .and_then(serde_json::Value::as_str)
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| {
                    io::Error::new(
                        io::ErrorKind::InvalidData,
                        format!(
                            "missing data_folder in {}; refusing predecessor cleanup",
                            config_path.display()
                        ),
                    )
                })?;
            let configured = PathBuf::from(configured);
            folders.push(if configured.is_absolute() {
                configured
            } else {
                product_root.join(configured)
            });
        }
    }
    Ok(folders)
}

#[cfg(any(windows, test))]
fn install_dir_contains_configured_data(candidate: &Path, configured: &[PathBuf]) -> bool {
    configured
        .iter()
        .any(|data_folder| same_or_descendant_path(data_folder, candidate))
}

pub fn run_biyan_windows_migration() -> io::Result<()> {
    run_biyan_windows_migration_inner()
}

#[cfg(not(windows))]
fn run_biyan_windows_migration_inner() -> io::Result<()> {
    Ok(())
}

#[cfg(windows)]
fn run_biyan_windows_migration_inner() -> io::Result<()> {
    run_biyan_windows_migration_windows()
}

#[cfg(windows)]
fn run_biyan_windows_migration_windows() -> io::Result<()> {
    use std::env;

    let appdata = match env::var_os("APPDATA") {
        Some(value) => PathBuf::from(value),
        None => return Ok(()),
    };

    let desktop = dirs::desktop_dir().unwrap_or_else(|| {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Desktop")
    });
    let programs = appdata
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs");

    let mut first_error = None;

    if let Err(error) = remove_legacy_shortcuts(appdata.clone(), desktop, programs) {
        first_error = Some(error);
    }
    if let Err(error) = cleanup_legacy_registry() {
        if first_error.is_none() {
            first_error = Some(error);
        }
    }

    let current_exe = match env::current_exe() {
        Ok(current_exe) => current_exe,
        Err(error) => {
            log::warn!("Skipping predecessor install folder cleanup: current exe unknown: {error}");
            return first_error
                .map(Err)
                .unwrap_or_else(|| Err(io::Error::new(error.kind(), error.to_string())));
        }
    };

    if let Some(local_app_data) = env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        let mut config_roots = vec![appdata];
        let local_identity = path_identity(&local_app_data);
        if !config_roots.iter().any(|root| {
            local_identity
                .as_ref()
                .is_some_and(|identity| path_identity(root).as_ref() == Some(identity))
        }) {
            config_roots.push(local_app_data.clone());
        }
        let configured_data = match configured_data_folders(&config_roots) {
            Ok(configured_data) => configured_data,
            Err(error) => {
                log::warn!(
                    "Skipping predecessor install folder cleanup because data-folder protection could not be established: {error}"
                );
                if first_error.is_none() {
                    first_error = Some(error);
                }
                return first_error.map(Err).unwrap_or(Ok(()));
            }
        };

        for candidate in legacy_install_candidates(local_app_data) {
            if legacy_install_dir_contains_payload(&candidate)
                && should_remove_legacy_install_dir(&candidate, &current_exe)
            {
                if install_dir_contains_configured_data(&candidate, &configured_data) {
                    log::warn!(
                        "Preserving predecessor install directory at {} because a configured data folder is equal to or nested below it",
                        candidate.display()
                    );
                    continue;
                }
                if let Err(error) = remove_legacy_install_dir(&candidate) {
                    if first_error.is_none() {
                        first_error = Some(error);
                    }
                }
            }
        }
    }

    first_error.map(Err).unwrap_or(Ok(()))
}

#[cfg(windows)]
fn remove_legacy_shortcuts(
    appdata: PathBuf,
    desktop: PathBuf,
    programs: PathBuf,
) -> io::Result<()> {
    let mut first_error = None;

    for shortcut in legacy_shortcut_paths(appdata, desktop, programs) {
        match fs::remove_file(&shortcut) {
            Ok(()) => log::info!("Removed predecessor shortcut at {}", shortcut.display()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                log::warn!(
                    "Failed to remove predecessor shortcut at {}: {error}",
                    shortcut.display()
                );
                if first_error.is_none() {
                    first_error = Some(io::Error::new(
                        error.kind(),
                        format!(
                            "failed to remove predecessor shortcut at {}: {error}",
                            shortcut.display()
                        ),
                    ));
                }
            }
        }
    }

    first_error.map(Err).unwrap_or(Ok(()))
}

#[cfg(any(windows, test))]
fn legacy_install_dir_contains_payload(candidate: &Path) -> bool {
    LEGACY_MAIN_BINARY_NAMES
        .iter()
        .any(|binary_name| candidate.join(binary_name).exists())
        || candidate.join("uninstall.exe").exists()
}

#[cfg(any(windows, test))]
fn remove_legacy_install_dir(candidate: &Path) -> io::Result<()> {
    for file_name in LEGACY_MANAGED_INSTALL_FILES {
        let managed_path = candidate.join(file_name);
        let metadata = match fs::symlink_metadata(&managed_path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                return Err(io::Error::new(
                    error.kind(),
                    format!(
                        "failed to inspect managed predecessor file at {}: {error}",
                        managed_path.display()
                    ),
                ));
            }
        };
        let file_type = metadata.file_type();
        if !(file_type.is_file() || file_type.is_symlink()) {
            log::warn!(
                "Preserving unexpected non-file at managed predecessor path {}",
                managed_path.display()
            );
            continue;
        }
        fs::remove_file(&managed_path).map_err(|error| {
            io::Error::new(
                error.kind(),
                format!(
                    "failed to remove managed predecessor file at {}: {error}",
                    managed_path.display()
                ),
            )
        })?;
        log::info!(
            "Removed managed predecessor file at {}",
            managed_path.display()
        );
    }

    match fs::remove_dir(candidate) {
        Ok(()) => log::info!(
            "Removed now-empty predecessor install directory at {}",
            candidate.display()
        ),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) if error.kind() == io::ErrorKind::DirectoryNotEmpty => {
            log::info!(
                "Preserved unknown content in predecessor install directory at {}",
                candidate.display()
            );
        }
        Err(error) => {
            return Err(io::Error::new(
                error.kind(),
                format!(
                    "failed to remove empty predecessor install directory at {}: {error}",
                    candidate.display()
                ),
            ));
        }
    }
    Ok(())
}

#[cfg(windows)]
fn cleanup_legacy_registry() -> io::Result<()> {
    use winreg::{
        enums::{HKEY_CURRENT_USER, KEY_READ, KEY_WRITE},
        RegKey,
    };

    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let mut first_error = None;

    for key in [
        r"Software\Jingxing\Mita",
        r"Software\Microsoft\Windows\CurrentVersion\Uninstall\Mita",
    ] {
        match hkcu.open_subkey_with_flags(key, KEY_READ | KEY_WRITE) {
            Ok(_) => {
                if let Err(error) = hkcu.delete_subkey_all(key) {
                    log::warn!("Failed to delete predecessor registry key HKCU\\{key}: {error}");
                    if first_error.is_none() {
                        first_error = Some(io::Error::new(
                            error.kind(),
                            format!(
                                "failed to delete predecessor registry key HKCU\\{key}: {error}"
                            ),
                        ));
                    }
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                log::debug!("Predecessor registry key HKCU\\{key} not writable: {error}");
                if first_error.is_none() {
                    first_error = Some(io::Error::new(
                        error.kind(),
                        format!("predecessor registry key HKCU\\{key} not writable: {error}"),
                    ));
                }
            }
        }
    }

    if let Err(error) = hkcu.delete_subkey(r"Software\Jingxing") {
        if error.kind() != io::ErrorKind::NotFound {
            log::debug!(
                "Legacy manufacturer registry key HKCU\\Software\\Jingxing not empty: {error}"
            );
        }
    }

    first_error.map(Err).unwrap_or(Ok(()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn windows_path_guard_is_case_insensitive_and_component_safe() {
        let install = Path::new(r"C:\Users\Owner\AppData\Local\Programs\Mita");
        assert!(same_or_descendant_path(
            Path::new(r"c:\users\owner\appdata\local\programs\mita\DATA"),
            install
        ));
        assert!(same_or_descendant_path(
            Path::new(r"C:\Users\Owner\AppData\Local\Programs\Mita"),
            install
        ));
        assert!(same_or_descendant_path(
            Path::new(r"C:\Users\Owner\AppData\Local\Programs\Mita\staging\..\DATA"),
            install
        ));
        assert!(!same_or_descendant_path(
            Path::new(r"C:\Users\Owner\AppData\Local\Programs\MitaBackup\data"),
            install
        ));
    }

    #[test]
    fn configured_relative_data_folder_is_resolved_beside_settings() {
        let root = tempdir().unwrap();
        let config_dir = root.path().join("Mita");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("settings.json"),
            br#"{"data_folder":"./custom-data"}"#,
        )
        .unwrap();

        let folders = configured_data_folders(&[root.path().to_path_buf()]).unwrap();
        assert!(folders.contains(&config_dir.join("custom-data")));
        assert!(folders.contains(&config_dir.join("data")));
    }

    #[test]
    fn invalid_settings_fail_closed() {
        let root = tempdir().unwrap();
        let config_dir = root.path().join("Mita");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(config_dir.join("settings.json"), b"{broken").unwrap();

        let error = configured_data_folders(&[root.path().to_path_buf()]).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    }

    #[test]
    fn configured_data_below_install_blocks_cleanup() {
        let root = tempdir().unwrap();
        let install = root.path().join("Programs").join("Mita");
        let data = install.join("user-data");
        fs::create_dir_all(&data).unwrap();
        fs::write(install.join("Mita.exe"), b"managed").unwrap();
        fs::write(data.join("threads.json"), b"user-data").unwrap();

        assert!(install_dir_contains_configured_data(
            &install,
            std::slice::from_ref(&data)
        ));
        assert!(install.join("Mita.exe").is_file());
        assert!(data.join("threads.json").is_file());
    }

    #[test]
    fn cleanup_removes_only_known_managed_files_and_preserves_unknown_content() {
        let root = tempdir().unwrap();
        let install = root.path().join("Mita");
        fs::create_dir_all(install.join("resources")).unwrap();
        fs::write(install.join("Mita.exe"), b"managed").unwrap();
        fs::write(install.join("uninstall.exe"), b"managed").unwrap();
        fs::write(install.join("keep-me.txt"), b"user-owned").unwrap();
        fs::write(install.join("resources").join("keep-me.bin"), b"unknown").unwrap();

        assert!(legacy_install_dir_contains_payload(&install));
        remove_legacy_install_dir(&install).unwrap();

        assert!(!install.join("Mita.exe").exists());
        assert!(!install.join("uninstall.exe").exists());
        assert!(!legacy_install_dir_contains_payload(&install));
        assert_eq!(
            fs::read(install.join("keep-me.txt")).unwrap(),
            b"user-owned"
        );
        assert_eq!(
            fs::read(install.join("resources").join("keep-me.bin")).unwrap(),
            b"unknown"
        );
    }

    #[test]
    fn cleanup_removes_install_directory_only_after_it_is_empty() {
        let root = tempdir().unwrap();
        let install = root.path().join("Mita");
        fs::create_dir_all(&install).unwrap();
        fs::write(install.join("Mita.exe"), b"managed").unwrap();

        remove_legacy_install_dir(&install).unwrap();
        assert!(!install.exists());
    }
}
