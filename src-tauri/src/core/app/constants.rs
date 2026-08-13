// App Configuration Constants
pub const APP_NAME: &str = "Biyan";
pub const CONFIGURATION_FILE_NAME: &str = "settings.json";

/// Stable published identity shared with `tauri.conf.json`. Do not rebrand it:
/// changing this value would split upgrade identity and existing user data.
pub const TAURI_BUNDLE_IDENTIFIER: &str = "uk.jingxing.mita";

// Categorised lists of Biyan data directories and files.
// The factory-reset logic selectively deletes by category based on user choices.
// Add new entries to the appropriate category so they are picked up automatically.

/// Conversations & user data — chat threads and assistant profiles.
/// Gated by the `keep_app_data` flag during factory reset.
pub const BIYAN_DATA_DIRS_CONVERSATIONS: &[&str] = &[
    "threads",
    "assistants",
    "image-assets",
    "video-assets",
    "agent-workspaces",
    "novels",
];

/// Current Biyan configuration files, excluding retired local-runtime data.
/// Gated by the `keep_configurations` flag during factory reset.
pub const BIYAN_DATA_FILES_CONFIGS: &[&str] = &["mcp_config.json"];

/// Extensions, logs, and caches — always cleaned during any reset.
pub const BIYAN_DATA_DIRS_COMMON: &[&str] = &["extensions", "logs", ".npx", ".uvx"];

/// Cross-category settings file (contains data spanning conversations,
/// provider configuration, and UI preferences). Only deleted during a full
/// wipe — i.e. when the user keeps neither conversations nor configurations.
/// After #7821, zustand stores persist to `settings.json` via @tauri-apps/plugin-store.
pub const BIYAN_DATA_FILES_SETTINGS: &[&str] = &["settings.json"];

/// All known data subdirectories (union of every category above).
pub const BIYAN_DATA_SUBDIRS: &[&str] = &[
    "threads",
    "assistants",
    "image-assets",
    "video-assets",
    "agent-workspaces",
    "novels",
    "extensions",
    "logs",
    ".npx",
    ".uvx",
];

/// All known data files (union of every file category above).
pub const BIYAN_DATA_FILES: &[&str] = &["mcp_config.json", "settings.json"];

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn configuration_file_name_matches_settings_entry() {
        assert_eq!(CONFIGURATION_FILE_NAME, "settings.json");
        assert!(BIYAN_DATA_FILES_SETTINGS.contains(&CONFIGURATION_FILE_NAME));
    }

    #[test]
    fn tauri_bundle_identifier_is_stable() {
        assert_eq!(TAURI_BUNDLE_IDENTIFIER, "uk.jingxing.mita");
    }

    #[test]
    fn biyan_data_subdirs_is_union_of_all_dir_categories() {
        let mut union: HashSet<&str> = HashSet::new();
        for entry in BIYAN_DATA_DIRS_CONVERSATIONS
            .iter()
            .chain(BIYAN_DATA_DIRS_COMMON.iter())
        {
            union.insert(*entry);
        }
        let listed: HashSet<&str> = BIYAN_DATA_SUBDIRS.iter().copied().collect();
        assert_eq!(
            union, listed,
            "BIYAN_DATA_SUBDIRS must equal union of categories"
        );
    }

    #[test]
    fn biyan_data_files_is_union_of_all_file_categories() {
        let mut union: HashSet<&str> = HashSet::new();
        for entry in BIYAN_DATA_FILES_CONFIGS
            .iter()
            .chain(BIYAN_DATA_FILES_SETTINGS.iter())
        {
            union.insert(*entry);
        }
        let listed: HashSet<&str> = BIYAN_DATA_FILES.iter().copied().collect();
        assert_eq!(union, listed);
    }

    #[test]
    fn dir_categories_have_no_overlap() {
        let conv: HashSet<&str> = BIYAN_DATA_DIRS_CONVERSATIONS.iter().copied().collect();
        let common: HashSet<&str> = BIYAN_DATA_DIRS_COMMON.iter().copied().collect();
        assert!(conv.is_disjoint(&common));
    }

    #[test]
    fn known_entries_present() {
        assert!(BIYAN_DATA_DIRS_CONVERSATIONS.contains(&"threads"));
        assert!(BIYAN_DATA_DIRS_CONVERSATIONS.contains(&"agent-workspaces"));
        assert!(BIYAN_DATA_DIRS_CONVERSATIONS.contains(&"novels"));
        assert!(BIYAN_DATA_DIRS_COMMON.contains(&"logs"));
        assert!(BIYAN_DATA_FILES_CONFIGS.contains(&"mcp_config.json"));
    }
}

// NOTE: when adding new entries, place them in the appropriate category above
// so the factory-reset logic handles them automatically. Then add them to the
// comprehensive BIYAN_DATA_SUBDIRS / BIYAN_DATA_FILES lists as well.
