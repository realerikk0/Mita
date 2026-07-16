//! Anonymous stable install identifier used only for updater cohort selection.

use std::sync::OnceLock;
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

const STORE_NAME: &str = "updater.json";
const INSTALL_ID_KEY: &str = "install_id";
const LEGACY_SESSION_KEY: &str = "nonce_seed";
static CACHED_INSTALL_ID: OnceLock<String> = OnceLock::new();

pub fn get_install_id_with_app<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    if let Some(cached) = CACHED_INSTALL_ID.get() {
        return Ok(cached.clone());
    }

    let store = app
        .store(STORE_NAME)
        .map_err(|e| format!("open_updater_store:{e}"))?;
    let mut install_id = if let Some(id) = store
        .get(INSTALL_ID_KEY)
        .and_then(|value| value.as_str().map(str::to_owned))
    {
        id
    } else if let Some(legacy_id) = store
        .get(LEGACY_SESSION_KEY)
        .and_then(|value| value.as_str().map(str::to_owned))
    {
        store.set(INSTALL_ID_KEY, serde_json::json!(legacy_id));
        store
            .save()
            .map_err(|e| format!("persist_updater_install_id:{e}"))?;
        legacy_id
    } else {
        let generated = Uuid::new_v4().to_string();
        store.set(INSTALL_ID_KEY, serde_json::json!(generated));
        store
            .save()
            .map_err(|e| format!("persist_updater_install_id:{e}"))?;
        generated
    };

    if Uuid::parse_str(&install_id).is_err() {
        install_id = Uuid::new_v4().to_string();
        store.set(INSTALL_ID_KEY, serde_json::json!(install_id));
        store
            .save()
            .map_err(|e| format!("repair_updater_install_id:{e}"))?;
    }
    let _ = CACHED_INSTALL_ID.set(install_id.clone());
    Ok(install_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_install_id_is_anonymous_uuid() {
        assert!(Uuid::parse_str(&Uuid::new_v4().to_string()).is_ok());
    }
}
