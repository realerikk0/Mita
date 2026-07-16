use super::{custom_updater::build_signed_request_headers, session::get_install_id_with_app};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::{fs, io::Write};
use tauri::{AppHandle, Manager};

use crate::core::app::constants::APP_NAME;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApprovedUpdateProvenance<'a> {
    target_version: &'a str,
    manifest_digest: &'a str,
}

#[tauri::command]
pub fn get_app_update_request_headers(
    app: AppHandle,
    current_version: String,
) -> Result<BTreeMap<String, String>, String> {
    if current_version.trim().is_empty() {
        return Err("current_version_required".to_string());
    }
    let install_id = get_install_id_with_app(&app)?;
    Ok(build_signed_request_headers(&install_id, &current_version))
}

/// Persist the exact updater response approved by the user before any bytes are
/// downloaded. Files are immutable and version-addressed, so the next binary can
/// attach the same manifest digest to every cumulative migration step.
#[tauri::command]
pub fn record_pending_update_manifest(
    app: AppHandle,
    target_version: String,
    manifest_json: String,
) -> Result<(), String> {
    if target_version.is_empty()
        || target_version.len() > 64
        || !target_version
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '+'))
    {
        return Err("invalid_update_target_version".to_string());
    }
    if manifest_json.is_empty() || manifest_json.len() > 1024 * 1024 {
        return Err("invalid_update_manifest_size".to_string());
    }
    let manifest: serde_json::Value = serde_json::from_str(&manifest_json)
        .map_err(|e| format!("invalid_update_manifest_json:{e}"))?;
    if manifest.get("version").and_then(serde_json::Value::as_str) != Some(target_version.as_str())
    {
        return Err("update_manifest_version_mismatch".to_string());
    }
    let mut digest = Sha256::new();
    digest.update(manifest_json.as_bytes());
    let manifest_digest = format!("{:x}", digest.finalize());
    let directory = app
        .path()
        .data_dir()
        .map_err(|e| format!("resolve_update_provenance_dir:{e}"))?
        .join(APP_NAME)
        .join("approved-updates");
    fs::create_dir_all(&directory).map_err(|e| format!("create_update_provenance_dir:{e}"))?;
    let destination = directory.join(format!("{target_version}-{manifest_digest}.json"));
    if destination.is_file() {
        return Ok(());
    }
    let temporary = directory.join(format!(
        ".{target_version}-{manifest_digest}-{}.tmp",
        std::process::id()
    ));
    let payload = serde_json::to_vec_pretty(&ApprovedUpdateProvenance {
        target_version: &target_version,
        manifest_digest: &manifest_digest,
    })
    .map_err(|e| format!("serialize_update_provenance:{e}"))?;
    {
        let mut file =
            fs::File::create(&temporary).map_err(|e| format!("create_update_provenance:{e}"))?;
        file.write_all(&payload)
            .map_err(|e| format!("write_update_provenance:{e}"))?;
        file.sync_all()
            .map_err(|e| format!("sync_update_provenance:{e}"))?;
    }
    match fs::rename(&temporary, &destination) {
        Ok(()) => Ok(()),
        Err(_) if destination.is_file() => {
            let _ = fs::remove_file(&temporary);
            Ok(())
        }
        Err(error) => {
            let _ = fs::remove_file(&temporary);
            Err(format!("commit_update_provenance:{error}"))
        }
    }
}
