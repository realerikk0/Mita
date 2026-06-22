use std::path::PathBuf;

use app_lib::core::windows_migration::{
    legacy_install_candidates, legacy_shortcut_paths, should_remove_legacy_install_dir,
};

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
fn should_remove_legacy_install_dir_keeps_extended_length_current_parent() {
    let current_exe = PathBuf::from(r"\\?\C:\Users\Owner\AppData\Local\Programs\Mita\mita.exe");
    let legacy_dir = PathBuf::from(r"C:\Users\Owner\AppData\Local\Programs\Mita");

    assert!(!should_remove_legacy_install_dir(&legacy_dir, &current_exe));
}

#[test]
fn should_remove_legacy_install_dir_keeps_uncertain_current_exe() {
    let current_exe = PathBuf::from("mita.exe");
    let legacy_dir = PathBuf::from(r"C:\Users\Owner\AppData\Local\Programs\Mita");

    assert!(!should_remove_legacy_install_dir(&legacy_dir, &current_exe));
}

#[cfg(unix)]
#[test]
fn should_remove_legacy_install_dir_keeps_canonical_current_parent() {
    use std::{fs, os::unix::fs::symlink};

    let temp = tempfile::tempdir().expect("create temp dir");
    let current_install_dir = temp.path().join("Programs").join("Mita");
    fs::create_dir_all(&current_install_dir).expect("create current install dir");
    let current_exe = current_install_dir.join("mita.exe");
    fs::write(&current_exe, "").expect("create current exe");

    let linked_install_dir = temp.path().join("LinkedMita");
    symlink(&current_install_dir, &linked_install_dir).expect("create install dir symlink");

    assert!(!should_remove_legacy_install_dir(
        &linked_install_dir,
        &current_exe
    ));
}

#[test]
fn should_remove_legacy_install_dir_removes_separate_mita_install() {
    let current_exe = PathBuf::from(r"C:\Users\Owner\AppData\Local\Programs\Biyan\mita.exe");
    let legacy_dir = PathBuf::from(r"C:\Users\Owner\AppData\Local\Programs\Mita");

    assert!(should_remove_legacy_install_dir(&legacy_dir, &current_exe));
}
