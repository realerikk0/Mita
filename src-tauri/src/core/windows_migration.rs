use std::{
    fs, io,
    path::{Path, PathBuf},
};

const LEGACY_PRODUCT_NAME: &str = "Mita";
#[cfg(windows)]
const LEGACY_MAIN_BINARY_NAMES: &[&str] = &[
    // Keep in sync with the legacy Windows installer MAINBINARYNAME. Windows path lookups are
    // case-insensitive, but both spellings make tests and future audits explicit.
    "Mita.exe", "mita.exe",
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
    let normalized = normalized.trim_end_matches('/').to_ascii_lowercase();

    if !normalized.contains('/') {
        return None;
    }

    Some(normalized)
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

    if let Err(error) = remove_legacy_shortcuts(appdata, desktop, programs) {
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
            log::warn!("Skipping legacy Mita install folder cleanup: current exe unknown: {error}");
            return first_error
                .map(Err)
                .unwrap_or_else(|| Err(io::Error::new(error.kind(), error.to_string())));
        }
    };

    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        for candidate in legacy_install_candidates(PathBuf::from(local_app_data)) {
            if legacy_install_dir_contains_payload(&candidate)
                && should_remove_legacy_install_dir(&candidate, &current_exe)
            {
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
            Ok(()) => log::info!("Removed legacy Mita shortcut at {}", shortcut.display()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                log::warn!(
                    "Failed to remove legacy Mita shortcut at {}: {error}",
                    shortcut.display()
                );
                if first_error.is_none() {
                    first_error = Some(io::Error::new(
                        error.kind(),
                        format!(
                            "failed to remove legacy Mita shortcut at {}: {error}",
                            shortcut.display()
                        ),
                    ));
                }
            }
        }
    }

    first_error.map(Err).unwrap_or(Ok(()))
}

#[cfg(windows)]
fn legacy_install_dir_contains_payload(candidate: &Path) -> bool {
    LEGACY_MAIN_BINARY_NAMES
        .iter()
        .any(|binary_name| candidate.join(binary_name).exists())
        || candidate.join("uninstall.exe").exists()
}

#[cfg(windows)]
fn remove_legacy_install_dir(candidate: &Path) -> io::Result<()> {
    match fs::remove_dir_all(candidate) {
        Ok(()) => {
            log::info!(
                "Removed legacy Mita install directory at {}",
                candidate.display()
            );
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => {
            log::warn!(
                "Failed to remove legacy Mita install directory at {}: {error}",
                candidate.display()
            );
            Err(io::Error::new(
                error.kind(),
                format!(
                    "failed to remove legacy Mita install directory at {}: {error}",
                    candidate.display()
                ),
            ))
        }
    }
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
                    log::warn!("Failed to delete legacy Mita registry key HKCU\\{key}: {error}");
                    if first_error.is_none() {
                        first_error = Some(io::Error::new(
                            error.kind(),
                            format!(
                                "failed to delete legacy Mita registry key HKCU\\{key}: {error}"
                            ),
                        ));
                    }
                }
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => {
                log::debug!("Legacy Mita registry key HKCU\\{key} not writable: {error}");
                if first_error.is_none() {
                    first_error = Some(io::Error::new(
                        error.kind(),
                        format!("legacy Mita registry key HKCU\\{key} not writable: {error}"),
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
