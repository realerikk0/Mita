// App Configuration Constants
pub const APP_NAME: &str = "Mita";
pub const LEGACY_SILENCE_APP_NAME: &str = "Silence";
pub const LEGACY_APP_NAME: &str = "Jan";
pub const CONFIGURATION_FILE_NAME: &str = "settings.json";

/// Tauri bundle `identifier` from `tauri.conf.json`. Used only as a fallback
/// source for legacy config recovery.
pub const TAURI_BUNDLE_IDENTIFIER: &str = "uk.jingxing.mita";
pub const LEGACY_SILENCE_TAURI_BUNDLE_IDENTIFIER: &str = "uk.jingxing.silence";
pub const LEGACY_TAURI_BUNDLE_IDENTIFIER: &str = "jan.ai.app";

// Categorised lists of Mita data directories and files.
// The factory-reset logic selectively deletes by category based on user choices.
// Add new entries to the appropriate category so they are picked up automatically.

/// Conversations & user data — chat threads and assistant profiles.
/// Gated by the `keep_app_data` flag during factory reset.
pub const MITA_DATA_DIRS_CONVERSATIONS: &[&str] = &["threads", "assistants"];

/// Downloaded models and engine binaries.
/// Gated by the `keep_models_and_configs` flag during factory reset.
pub const MITA_DATA_DIRS_MODELS: &[&str] = &["models", "llamacpp", "mlx", "openclaw"];

/// Configuration files — engine settings, MCP config, etc.
/// Gated by the `keep_models_and_configs` flag during factory reset.
pub const MITA_DATA_FILES_CONFIGS: &[&str] = &["mcp_config.json"];

/// Extensions, logs, and caches — always cleaned during any reset.
pub const MITA_DATA_DIRS_COMMON: &[&str] = &["extensions", "logs", ".npx", ".uvx"];

/// Cross-category settings file (contains data spanning conversations, models,
/// and UI preferences). Only deleted during a full wipe — i.e. when the user
/// keeps neither conversations nor models/configs.
/// After #7821, zustand stores persist to `settings.json` via @tauri-apps/plugin-store.
pub const MITA_DATA_FILES_SETTINGS: &[&str] = &["settings.json"];

/// All known data subdirectories (union of every category above).
pub const MITA_DATA_SUBDIRS: &[&str] = &[
    "threads",
    "assistants",
    "extensions",
    "logs",
    "models",
    "llamacpp",
    "mlx",
    "openclaw",
    ".npx",
    ".uvx",
];

/// All known data files (union of every file category above).
pub const MITA_DATA_FILES: &[&str] = &["mcp_config.json", "settings.json"];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn configuration_file_name_matches_settings_entry() {
        assert_eq!(CONFIGURATION_FILE_NAME, "settings.json");
        assert!(MITA_DATA_FILES_SETTINGS.contains(&CONFIGURATION_FILE_NAME));
    }

    #[test]
    fn tauri_bundle_identifier_is_stable() {
        assert_eq!(TAURI_BUNDLE_IDENTIFIER, "uk.jingxing.mita");
    }

    #[test]
    fn mita_data_subdirs_is_union_of_all_dir_categories() {
        let mut union: HashSet<&str> = HashSet::new();
        for entry in MITA_DATA_DIRS_CONVERSATIONS
            .iter()
            .chain(MITA_DATA_DIRS_MODELS.iter())
            .chain(MITA_DATA_DIRS_COMMON.iter())
        {
            union.insert(*entry);
        }
        let listed: HashSet<&str> = MITA_DATA_SUBDIRS.iter().copied().collect();
        assert_eq!(
            union, listed,
            "MITA_DATA_SUBDIRS must equal union of categories"
        );
    }

    #[test]
    fn mita_data_files_is_union_of_all_file_categories() {
        let mut union: HashSet<&str> = HashSet::new();
        for entry in MITA_DATA_FILES_CONFIGS
            .iter()
            .chain(MITA_DATA_FILES_SETTINGS.iter())
        {
            union.insert(*entry);
        }
        let listed: HashSet<&str> = MITA_DATA_FILES.iter().copied().collect();
        assert_eq!(union, listed);
    }

    #[test]
    fn dir_categories_have_no_overlap() {
        let conv: HashSet<&str> = MITA_DATA_DIRS_CONVERSATIONS.iter().copied().collect();
        let models: HashSet<&str> = MITA_DATA_DIRS_MODELS.iter().copied().collect();
        let common: HashSet<&str> = MITA_DATA_DIRS_COMMON.iter().copied().collect();
        assert!(conv.is_disjoint(&models));
        assert!(conv.is_disjoint(&common));
        assert!(models.is_disjoint(&common));
    }

    #[test]
    fn known_entries_present() {
        assert!(MITA_DATA_DIRS_CONVERSATIONS.contains(&"threads"));
        assert!(MITA_DATA_DIRS_MODELS.contains(&"models"));
        assert!(MITA_DATA_DIRS_COMMON.contains(&"logs"));
        assert!(MITA_DATA_FILES_CONFIGS.contains(&"mcp_config.json"));
    }
}

// NOTE: when adding new entries, place them in the appropriate category above
// so the factory-reset logic handles them automatically. Then add them to the
// comprehensive MITA_DATA_SUBDIRS / MITA_DATA_FILES lists as well.
