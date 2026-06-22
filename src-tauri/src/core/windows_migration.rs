use std::path::{Path, PathBuf};

const LEGACY_PRODUCT_NAME: &str = "Mita";
#[cfg(windows)]
const PRODUCT_NAME: &str = "Biyan";
#[cfg(windows)]
const MAIN_BINARY_NAME: &str = "mita.exe";

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
    let legacy_dir = normalize_path_for_compare(legacy_dir);
    let current_exe = normalize_path_for_compare(current_exe);
    let Some((current_parent, _)) = current_exe.rsplit_once('/') else {
        return true;
    };

    legacy_dir != current_parent
}

fn normalize_path_for_compare(path: &Path) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    normalized.trim_end_matches('/').to_ascii_lowercase()
}

pub fn run_biyan_windows_migration() {
    run_biyan_windows_migration_inner();
}

#[cfg(not(windows))]
fn run_biyan_windows_migration_inner() {}

#[cfg(windows)]
fn run_biyan_windows_migration_inner() {
    if let Err(error) = run_biyan_windows_migration_windows() {
        log::warn!("Failed to complete Biyan Windows migration self-heal: {error}");
    }
}

#[cfg(windows)]
fn run_biyan_windows_migration_windows() -> std::io::Result<()> {
    use std::{env, fs};

    let current_exe = env::current_exe()?;
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

    for shortcut in legacy_shortcut_paths(appdata.clone(), desktop, programs.clone()) {
        if shortcut.exists() {
            let _ = fs::remove_file(&shortcut);
        }
    }

    if let Some(local_app_data) = env::var_os("LOCALAPPDATA") {
        for candidate in legacy_install_candidates(PathBuf::from(local_app_data)) {
            if should_remove_legacy_install_dir(&candidate, &current_exe) {
                remove_legacy_install_dir(&candidate);
            }
        }
    }

    ensure_biyan_start_menu_shortcut(&programs, &current_exe);
    cleanup_legacy_registry();

    Ok(())
}

#[cfg(windows)]
fn remove_legacy_install_dir(candidate: &Path) {
    use std::fs;

    if !(candidate.join(MAIN_BINARY_NAME).exists() || candidate.join("uninstall.exe").exists()) {
        return;
    }

    let _ = fs::remove_file(candidate.join(MAIN_BINARY_NAME));
    let _ = fs::remove_file(candidate.join("uninstall.exe"));
    let _ = fs::remove_dir_all(candidate.join("resources"));
    let _ = fs::remove_dir(candidate);
}

#[cfg(windows)]
fn ensure_biyan_start_menu_shortcut(programs: &Path, current_exe: &Path) {
    use std::{fs, process::Command};

    let _ = fs::create_dir_all(programs);
    let shortcut_path = programs.join(format!("{PRODUCT_NAME}.lnk"));
    if shortcut_path.exists() {
        return;
    }

    let script = r#"
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($env:BIYAN_SHORTCUT_PATH)
$shortcut.TargetPath = $env:BIYAN_TARGET_PATH
$shortcut.WorkingDirectory = Split-Path -Parent $env:BIYAN_TARGET_PATH
$shortcut.Save()
"#;

    let _ = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-Command")
        .arg(script)
        .env("BIYAN_SHORTCUT_PATH", &shortcut_path)
        .env("BIYAN_TARGET_PATH", current_exe)
        .status();
}

#[cfg(windows)]
fn cleanup_legacy_registry() {
    use std::process::Command;

    for key in [
        r"HKCU\Software\Jingxing\Mita",
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Mita",
        r"HKLM\Software\Jingxing\Mita",
        r"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall\Mita",
    ] {
        let _ = Command::new("reg").args(["delete", key, "/f"]).status();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_shortcut_paths_cover_start_desktop_and_pinned_entries() {
        let paths = legacy_shortcut_paths(
            PathBuf::from(r"C:\Users\Owner\AppData\Roaming"),
            PathBuf::from(r"C:\Users\Owner\Desktop"),
            PathBuf::from(r"C:\Users\Owner\AppData\Roaming\Microsoft\Windows\Start Menu\Programs"),
        );

        let rendered = paths
            .iter()
            .map(|path| path.to_string_lossy().replace('/', "\\"))
            .collect::<Vec<_>>();

        assert!(rendered.contains(&r"C:\Users\Owner\Desktop\Mita.lnk".to_string()));
        assert!(rendered.contains(
            &r"C:\Users\Owner\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Mita.lnk"
                .to_string(),
        ));
        assert!(
            rendered.contains(
                &r"C:\Users\Owner\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Mita.lnk"
                    .to_string(),
            )
        );
        assert!(
            rendered.contains(
                &r"C:\Users\Owner\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu\Mita.lnk"
                    .to_string(),
            )
        );
    }

    #[test]
    fn legacy_install_candidates_include_default_mita_install_dir() {
        let candidates = legacy_install_candidates(PathBuf::from(r"C:\Users\Owner\AppData\Local"));

        assert_eq!(
            candidates
                .iter()
                .map(|path| path.to_string_lossy().replace('/', "\\"))
                .collect::<Vec<_>>(),
            vec![r"C:\Users\Owner\AppData\Local\Programs\Mita".to_string()]
        );
    }

    #[test]
    fn should_remove_legacy_install_dir_never_removes_current_install_parent() {
        let current_exe = PathBuf::from(r"C:\Users\Owner\AppData\Local\Programs\Mita\mita.exe");
        let legacy_dir = PathBuf::from(r"C:\Users\Owner\AppData\Local\Programs\Mita");

        assert!(!should_remove_legacy_install_dir(&legacy_dir, &current_exe));
    }

    #[test]
    fn should_remove_legacy_install_dir_removes_separate_mita_install() {
        let current_exe = PathBuf::from(r"C:\Users\Owner\AppData\Local\Programs\Biyan\mita.exe");
        let legacy_dir = PathBuf::from(r"C:\Users\Owner\AppData\Local\Programs\Mita");

        assert!(should_remove_legacy_install_dir(&legacy_dir, &current_exe));
    }
}
