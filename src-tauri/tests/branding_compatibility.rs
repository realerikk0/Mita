use std::{fs, path::PathBuf};

use serde_json::Value;

fn manifest_file(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(name)
}

#[test]
fn published_identity_and_compatibility_routes_stay_stable() {
    let content =
        fs::read_to_string(manifest_file("tauri.conf.json")).expect("read tauri.conf.json");
    let config: Value = serde_json::from_str(&content).expect("parse tauri.conf.json");

    assert_eq!(config["identifier"], "uk.jingxing.mita");
    assert_eq!(
        config["plugins"]["deep-link"]["desktop"]["schemes"],
        serde_json::json!(["biyan", "mita"]),
        "mita:// remains a compatibility ingress for existing provider-import links"
    );
    assert_eq!(
        config["plugins"]["updater"]["endpoints"],
        serde_json::json!([
            "https://updates.mita.so/biyan/v1/stable/{{target}}/{{arch}}/{{current_version}}"
        ]),
        "the published updater route is compatibility infrastructure"
    );
}

#[test]
fn native_packaging_uses_only_supported_deep_links_and_portable_paths() {
    let info_plist = fs::read_to_string(manifest_file("Info.plist")).expect("read Info.plist");
    assert!(info_plist.contains("<string>uk.jingxing.mita</string>"));
    assert!(info_plist.contains("<string>biyan</string>"));
    assert!(info_plist.contains("<string>mita</string>"));
    assert!(!info_plist.contains("<string>silence</string>"));

    let nsis = fs::read_to_string(manifest_file("tauri.bundle.windows.nsis.template"))
        .expect("read NSIS template");
    assert!(
        !nsis.contains(r"D:\a"),
        "NSIS must not embed a CI checkout path"
    );
    assert!(!nsis.contains("mita-cli.exe"));
    assert!(nsis.contains("{{#each resources}}"));
    assert!(nsis.contains("{{#each deep_link_protocols as |protocol| ~}}"));
}
