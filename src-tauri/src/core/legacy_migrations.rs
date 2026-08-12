//! Forward-only, cumulative migrations from Jan/Silence/Mita layouts to Biyan.
//!
//! Keep this module small and dependency-light. Every released Biyan build must retain these
//! migrations so a user can install the latest full installer without visiting intermediate
//! releases first.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
#[cfg(feature = "mobile")]
use sqlx::sqlite::{SqliteConnectOptions, SqlitePool, SqlitePoolOptions};
#[cfg(feature = "mobile")]
use sqlx::Row;
#[cfg(feature = "mobile")]
use std::str::FromStr;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex as StdMutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, Runtime};
use uuid::Uuid;

use crate::core::{
    app::{constants::CONFIGURATION_FILE_NAME, models::AppConfiguration},
    mcp::constants::{default_web_research_mcp_config, BIYAN_WEB_RESEARCH_MCP_NAME},
};

pub const TARGET_DATA_SCHEMA: u32 = 3;
const STATE_FILE: &str = "migration-state.json";
const LOCK_FILE: &str = ".migration.lock";
const APPROVED_UPDATES_DIR: &str = "approved-updates";
const CLEANUP_CONFIRMATION_TTL_MS: u128 = 10 * 60 * 1000;
const CLEANUP_JOURNAL_FILE: &str = "cleanup-journal.json";
const EMBEDDED_RELEASE_ATTESTATION: &str = include_str!("../../../biyan-release.json");
const LEGACY_DEFAULT_ASSISTANT_IDS: &[&str] = &["mita", "silence", "jan"];
const DATA_LAYOUT_NAMES: &[&str] = &[
    "Biyan",
    "Mita",
    "Silence",
    "Jan",
    "uk.jingxing.mita",
    "uk.jingxing.silence",
    "jan.ai.app",
];
const USER_DATA_DIRS: &[&str] = &[
    "threads",
    "assistants",
    "image-assets",
    "video-assets",
    "agent-workspaces",
    "novels",
];
const USER_DATA_FILES: &[&str] = &["settings.json", "mcp_config.json", "store.json"];
pub const LEGACY_LOCAL_DATA_DIRS: &[&str] = &[
    "models",
    "hub",
    "llamacpp",
    "mlx",
    "rag",
    "vector-db",
    "embeddings",
    "embedding-models",
];
pub const LEGACY_MITA_WEB_RESEARCH_MCP_NAME: &str = "Mita Web Research";
pub const LEGACY_SILENCE_WEB_RESEARCH_MCP_NAME: &str = "Silence Web Research";
pub const LEGACY_SILENCE_BROWSER_MCP_NAME: &str = "Silence Browser MCP";
pub const LEGACY_JAN_BROWSER_MCP_NAME: &str = "Jan Browser MCP";
const LEGACY_COMPUTER_SERVER_NAME: &str = "mita-computer";
const LEGACY_WINDOWS_RUNNER_PATH_ENV: &str = "MITA_WINDOWS_COMPUTER_AGENT_RUNNER";
const LEGACY_PRIMARY_SIGNING_KEY: Option<&str> = option_env!("MITA_SIGNING_KEY");
const LEGACY_FALLBACK_SIGNING_KEY: Option<&str> = option_env!("JAN_SIGNING_KEY");
const LEGACY_LOCAL_API_MARKERS: &[&str] = &[
    "# Mita Local API Server - Claude Code Config",
    "# Mita Local API Server",
    "# Silence Local API Server - Claude Code Config",
    "# Silence Local API Server",
    "# Jan Local API Server - Claude Code Config",
    "# Jan Local API Server",
];

pub fn compiled_target_data_schema() -> u32 {
    option_env!("BIYAN_DATA_SCHEMA")
        .and_then(|value| value.parse::<u32>().ok())
        .filter(|value| (1..=TARGET_DATA_SCHEMA).contains(value))
        .unwrap_or(TARGET_DATA_SCHEMA)
}

pub fn updater_request_signing_key() -> &'static str {
    if let Some(key) = option_env!("BIYAN_SIGNING_KEY") {
        return key;
    }
    if compiled_target_data_schema() == 1 {
        if let Some(key) = LEGACY_PRIMARY_SIGNING_KEY.or(LEGACY_FALLBACK_SIGNING_KEY) {
            eprintln!("Biyan A bridge was built with a deprecated updater request key");
            return key;
        }
    }
    "biyan-development-signing-key-not-for-release"
}

pub fn normalize_browser_mcp_server_key(mcp_servers: &mut Map<String, Value>) -> bool {
    let mut legacy_configs = Vec::new();
    for legacy_name in [
        LEGACY_MITA_WEB_RESEARCH_MCP_NAME,
        LEGACY_SILENCE_WEB_RESEARCH_MCP_NAME,
        LEGACY_SILENCE_BROWSER_MCP_NAME,
        LEGACY_JAN_BROWSER_MCP_NAME,
    ] {
        if let Some(config) = mcp_servers.remove(legacy_name) {
            legacy_configs.push((legacy_name, config));
        }
    }
    if legacy_configs.is_empty() {
        return false;
    }

    let old_active = legacy_configs
        .iter()
        .find_map(|(_, config)| config.get("active"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if !mcp_servers.contains_key(BIYAN_WEB_RESEARCH_MCP_NAME) {
        let mut browser_config = default_web_research_mcp_config();
        if let Some(config) = browser_config.as_object_mut() {
            config.insert("active".to_string(), json!(old_active));
        }
        mcp_servers.insert(BIYAN_WEB_RESEARCH_MCP_NAME.to_string(), browser_config);
    }

    for (legacy_name, mut config) in legacy_configs {
        // `official: true` is not a trustworthy stock fingerprint: older
        // builds let users edit the rest of the object without clearing it.
        // Preserve every legacy object as a disabled conflict copy so no custom
        // command/env is silently discarded. The canonical managed entry above
        // is the only one that may retain the previous active state.
        if let Some(object) = config.as_object_mut() {
            object.insert("active".to_string(), json!(false));
            object.insert("official".to_string(), json!(false));
            object.insert("migrationConflict".to_string(), json!(true));
            object.insert("legacyName".to_string(), json!(legacy_name));
        }
        let mut suffix = 1;
        let mut imported_name = "Imported web research MCP (disabled)".to_string();
        while mcp_servers.contains_key(&imported_name) {
            suffix += 1;
            imported_name = format!("Imported web research MCP {suffix} (disabled)");
        }
        mcp_servers.insert(imported_name, config);
    }
    true
}

/// Fail-closed recognition for extension IDs retired during the Biyan bridge.
/// Kept in this isolated module so old identifiers never leak into normal runtime output.
pub fn is_retired_local_extension_id(id: &str) -> bool {
    let normalized = id.to_ascii_lowercase();
    normalized.contains("llamacpp")
        || normalized.contains("llama.cpp")
        || normalized.contains("mlx-extension")
        || normalized.contains("foundation-models")
        || normalized.contains("rag-extension")
        || normalized.contains("vector-db")
        || normalized.contains("embedding-extension")
}

/// Compatibility is ingress-only: callers may submit an old stock assistant ID,
/// but normal storage and responses use `biyan` exclusively.
pub fn normalize_assistant_ingress_id(id: &str) -> &str {
    if LEGACY_DEFAULT_ASSISTANT_IDS.contains(&id) {
        "biyan"
    } else {
        id
    }
}

pub fn is_legacy_computer_server_name(name: &str) -> bool {
    name == LEGACY_COMPUTER_SERVER_NAME
}

pub fn legacy_windows_runner_override() -> Option<PathBuf> {
    std::env::var_os(LEGACY_WINDOWS_RUNNER_PATH_ENV).map(PathBuf::from)
}

pub fn legacy_cli_shim_file_name() -> &'static str {
    if cfg!(windows) {
        "mita.exe"
    } else {
        "mita"
    }
}

pub fn is_legacy_local_api_marker(line: &str) -> bool {
    LEGACY_LOCAL_API_MARKERS
        .iter()
        .any(|marker| line.starts_with(marker))
}

#[cfg(test)]
pub fn legacy_local_api_marker_fixture() -> &'static str {
    LEGACY_LOCAL_API_MARKERS[4]
}

pub fn is_retired_download_url(url: &url::Url) -> bool {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let path = url.path().to_ascii_lowercase();
    let is_retired_domain = host == "jan.ai" || host.ends_with(".jan.ai");
    let is_retired_github = match host.as_str() {
        "github.com" | "raw.githubusercontent.com" => path.starts_with("/janhq/"),
        "api.github.com" => path.starts_with("/repos/janhq/"),
        _ => false,
    };
    let is_hub_repository_file = (host == "huggingface.co" || host.ends_with(".huggingface.co"))
        && path.contains("/resolve/");
    is_retired_domain || is_retired_github || is_hub_repository_file
}

fn discover_legacy_data_sources(base: &Path) -> Vec<PathBuf> {
    discover_data_sources(base, None, None)
        .map(|sources| {
            sources
                .into_iter()
                .filter(|source| source.identity != "Biyan")
                .map(|source| source.path)
                .collect()
        })
        .unwrap_or_default()
}

/// Recovery-only discovery is deliberately tolerant per candidate: a corrupt
/// Jan config must not hide a valid Mita custom directory from the recovery
/// page. Normal migration continues to use the strict resolver above.
fn discover_recovery_data_sources(base: &Path, config_root: Option<&Path>) -> Vec<PathBuf> {
    let mut sources = Vec::new();
    let mut biyan_backups = Vec::new();
    for identity in DATA_LAYOUT_NAMES {
        for config_path in configuration_candidates_for_identity(base, config_root, identity) {
            let Some(configuration) = parse_config(&config_path) else {
                continue;
            };
            if configuration.data_folder.trim().is_empty() {
                continue;
            }
            let configured = configured_data_path(&config_path, &configuration);
            let mut has_backup = false;
            if let Ok((_, backup)) = data_migration_paths(&configured) {
                if backup.exists() {
                    has_backup = true;
                    if *identity == "Biyan" {
                        push_unique_path(&mut biyan_backups, backup);
                    } else {
                        push_unique_path(&mut sources, backup);
                    }
                }
            }
            if *identity != "Biyan" && !has_backup && configured.exists() {
                push_unique_path(&mut sources, configured);
            }
        }
        let default_data = base.join(identity).join("data");
        let mut has_backup = false;
        if let Ok((_, backup)) = data_migration_paths(&default_data) {
            if backup.exists() {
                has_backup = true;
                if *identity == "Biyan" {
                    push_unique_path(&mut biyan_backups, backup);
                } else {
                    push_unique_path(&mut sources, backup);
                }
            }
        }
        if *identity != "Biyan" && !has_backup && default_data.exists() {
            push_unique_path(&mut sources, default_data);
        }
    }
    for backup in biyan_backups {
        push_unique_path(&mut sources, backup);
    }
    sources
}

fn push_unique_path(paths: &mut Vec<PathBuf>, path: PathBuf) {
    if !paths.iter().any(|existing| existing == &path) {
        paths.push(path);
    }
}

pub fn first_legacy_data_source(base: &Path) -> Option<PathBuf> {
    retained_legacy_sources_in(base)
        .ok()
        .and_then(|sources| sources.into_iter().next())
        .or_else(|| discover_legacy_data_sources(base).into_iter().next())
}

pub fn recovery_legacy_sources_for_app<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<Vec<PathBuf>, String> {
    let base = app
        .path()
        .data_dir()
        .map_err(|error| format!("resolve_migration_sources:{error}"))?;
    let mut sources = retained_legacy_sources_in(&base).unwrap_or_default();
    let config_root = app.path().config_dir().ok();
    for source in discover_recovery_data_sources(&base, config_root.as_deref()) {
        push_unique_path(&mut sources, source);
    }
    Ok(sources)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StepStatus {
    Pending,
    Running,
    Completed,
    Failed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationStepState {
    pub status: StepStatus,
    pub source_schema: u32,
    pub target_schema: u32,
    pub updated_at_unix_ms: u128,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest_digest: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationState {
    pub format_version: u32,
    pub data_schema: u32,
    pub source_app_version: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest_digest: Option<String>,
    #[serde(default)]
    pub extensions_schema: u32,
    /// Every valid legacy source which was deliberately left untouched. The
    /// first entry is the deterministic migration source; the remaining entries
    /// are conflicts which are never merged automatically.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub retained_legacy_sources: Vec<String>,
    /// Exact source selected by the deterministic brand-priority resolver.
    /// This is intentionally separate from retained sources: the selected
    /// source may be a custom path which is atomically replaced in-place.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub selected_source: Option<String>,
    /// The one authoritative mapping produced by the filesystem assistant
    /// migration. Desktop JSON, mobile SQLite and browser storage all consume
    /// this mapping instead of guessing from directory names.
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub assistant_id_map: BTreeMap<String, String>,
    pub steps: BTreeMap<String, MigrationStepState>,
}

impl Default for MigrationState {
    fn default() -> Self {
        Self {
            format_version: 1,
            data_schema: 0,
            source_app_version: String::new(),
            manifest_digest: None,
            extensions_schema: 0,
            retained_legacy_sources: Vec::new(),
            selected_source: None,
            assistant_id_map: BTreeMap::new(),
            steps: BTreeMap::new(),
        }
    }
}

#[derive(Debug)]
pub struct MigrationReport {
    /// Schema requested by the running application artifact. This may be ahead of
    /// `completed_data_schema` until platform-specific component reconciliation
    /// (mobile SQLite / bundled extensions) succeeds later in startup.
    pub target_data_schema: u32,
    pub completed_data_schema: u32,
    pub canonical_config_dir: PathBuf,
    pub canonical_data_dir: PathBuf,
    pub retained_legacy_sources: Vec<PathBuf>,
    _lock: MigrationLock,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyLocalDataEntry {
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyLocalDataInspection {
    pub entries: Vec<LegacyLocalDataEntry>,
    pub total_bytes: u64,
    pub confirmation_token: String,
}

#[derive(Debug)]
struct MigrationLock {
    file: fs::File,
}

#[derive(Debug, Clone)]
struct PendingCleanupConfirmation {
    token: String,
    snapshot_digest: String,
    expires_at_unix_ms: u128,
    snapshot: CleanupSnapshot,
}

#[derive(Debug, Clone)]
struct CleanupSnapshot {
    inspection: LegacyLocalDataInspection,
    canonical_data_path: String,
    canonical_manifest: BTreeMap<String, (u64, String)>,
    snapshot_digest: String,
    entries: BTreeMap<String, CleanupEntrySnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CleanupEntrySnapshot {
    root: String,
    path: String,
    bytes: u64,
    modified_unix_nanos: u128,
    content_digest: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
enum CleanupJournalStatus {
    Pending,
    Completed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CleanupJournalEntry {
    root: String,
    path: String,
    bytes: u64,
    modified_unix_nanos: u128,
    content_digest: String,
    removed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CleanupJournal {
    format_version: u32,
    status: CleanupJournalStatus,
    snapshot_digest: String,
    confirmation_digest: String,
    started_at_unix_ms: u128,
    updated_at_unix_ms: u128,
    total_bytes: u64,
    entries: Vec<CleanupJournalEntry>,
}

static PENDING_CLEANUP_CONFIRMATIONS: OnceLock<
    StdMutex<BTreeMap<String, PendingCleanupConfirmation>>,
> = OnceLock::new();

impl Drop for MigrationLock {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.file);
    }
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn acquire_lock(config_dir: &Path) -> Result<MigrationLock, String> {
    fs::create_dir_all(config_dir).map_err(|e| format!("create_config_dir:{e}"))?;
    let path = config_dir.join(LOCK_FILE);

    let mut file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .open(&path)
        .map_err(|e| format!("open_migration_lock:{e}"))?;
    fs2::FileExt::try_lock_exclusive(&file).map_err(|e| format!("migration_locked:{e}"))?;
    file.set_len(0).map_err(|e| format!("truncate_lock:{e}"))?;
    writeln!(file, "pid={} started_at={}", std::process::id(), now_ms())
        .map_err(|e| format!("write_lock:{e}"))?;
    file.sync_all().map_err(|e| format!("sync_lock:{e}"))?;
    Ok(MigrationLock { file })
}

#[cfg(windows)]
pub(crate) fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        Err(format!("commit_tmp:{}", std::io::Error::last_os_error()))
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
pub(crate) fn atomic_replace(source: &Path, destination: &Path) -> Result<(), String> {
    fs::rename(source, destination).map_err(|e| format!("commit_tmp:{e}"))
}

pub(crate) fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| "missing_parent".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("create_parent:{e}"))?;
    let tmp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("migration"),
        std::process::id()
    ));
    {
        let mut file = fs::File::create(&tmp).map_err(|e| format!("create_tmp:{e}"))?;
        file.write_all(contents)
            .map_err(|e| format!("write_tmp:{e}"))?;
        file.sync_all().map_err(|e| format!("sync_tmp:{e}"))?;
    }
    atomic_replace(&tmp, path)?;
    #[cfg(unix)]
    fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|e| format!("sync_parent:{e}"))?;
    Ok(())
}

fn load_state(path: &Path) -> Result<MigrationState, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(MigrationState::default())
        }
        Err(error) => return Err(format!("read_migration_state:{error}")),
    };
    let mut state: MigrationState =
        serde_json::from_str(&raw).map_err(|error| format!("invalid_migration_state:{error}"))?;
    if state.format_version != 1 {
        return Err(format!(
            "unsupported_migration_state_format:{}",
            state.format_version
        ));
    }
    if state.data_schema > TARGET_DATA_SCHEMA {
        return Err(format!(
            "unsupported_migration_state_schema:{}",
            state.data_schema
        ));
    }
    let is_sha256 =
        |value: &str| value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit());
    if state
        .manifest_digest
        .as_deref()
        .is_some_and(|digest| !is_sha256(digest))
    {
        return Err("invalid_migration_state_manifest_digest".to_string());
    }
    let known_steps = BTreeMap::from([
        ("layout_v1", (0, 1)),
        ("mobile_db_v1", (0, 1)),
        ("assistant_ids_v1", (0, 1)),
        ("mcp_names_v1", (0, 1)),
        ("extensions_manifest_v1", (0, 1)),
        ("cli_v1", (0, 1)),
        ("assistant_db_refs_v1", (0, 1)),
        ("remote_only_v2", (1, 2)),
        ("cleanup_v3", (2, 3)),
    ]);
    for (id, step) in &state.steps {
        if let Some((source_schema, target_schema)) = known_steps.get(id.as_str()) {
            if (step.source_schema, step.target_schema) != (*source_schema, *target_schema) {
                return Err(format!("invalid_migration_step_schema:{id}"));
            }
        }
        if step
            .manifest_digest
            .as_deref()
            .is_some_and(|digest| !is_sha256(digest))
            || (step.status == StepStatus::Completed && step.manifest_digest.is_none())
        {
            return Err(format!("invalid_migration_step_manifest_digest:{id}"));
        }
    }
    let recorded_schema = state.data_schema;
    recompute_committed_schema(&mut state);
    if recorded_schema > state.data_schema {
        return Err(format!(
            "inconsistent_migration_state_schema:{recorded_schema}:{}",
            state.data_schema
        ));
    }
    if step_completed(&state, "extensions_manifest_v1") && state.extensions_schema < 1 {
        state.extensions_schema = 1;
    }
    Ok(state)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovedUpdateProvenance {
    target_version: String,
    manifest_digest: String,
}

fn release_attestation_digest(app_version: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"biyan-release-attestation-v1\0");
    digest.update(app_version.as_bytes());
    digest.update([0]);
    digest.update(EMBEDDED_RELEASE_ATTESTATION.as_bytes());
    format!("{:x}", digest.finalize())
}

fn approved_manifest_digest(
    config_dir: &Path,
    app_version: &str,
) -> Result<Option<String>, String> {
    let directory = config_dir.join(APPROVED_UPDATES_DIR);
    if !directory.is_dir() {
        return Ok(None);
    }
    let mut matching = BTreeSet::new();
    for entry in fs::read_dir(&directory).map_err(|e| format!("read_update_provenance:{e}"))? {
        let entry = entry.map_err(|e| format!("read_update_provenance_entry:{e}"))?;
        if !entry
            .file_type()
            .map_err(|e| format!("read_update_provenance_type:{e}"))?
            .is_file()
            || entry.path().extension().and_then(|value| value.to_str()) != Some("json")
        {
            continue;
        }
        let raw = fs::read_to_string(entry.path())
            .map_err(|e| format!("read_update_provenance_file:{e}"))?;
        let provenance: ApprovedUpdateProvenance =
            serde_json::from_str(&raw).map_err(|e| format!("invalid_update_provenance:{e}"))?;
        if provenance.target_version != app_version {
            continue;
        }
        if provenance.manifest_digest.len() != 64
            || !provenance
                .manifest_digest
                .bytes()
                .all(|value| value.is_ascii_hexdigit())
        {
            return Err("invalid_update_provenance_digest".to_string());
        }
        matching.insert(provenance.manifest_digest.to_ascii_lowercase());
    }
    if matching.len() > 1 {
        return Err("ambiguous_update_manifest_provenance".to_string());
    }
    Ok(matching.into_iter().next())
}

fn save_state(path: &Path, state: &MigrationState) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(state).map_err(|e| format!("serialize_state:{e}"))?;
    atomic_write(path, &payload)
}

fn set_step(
    state_path: &Path,
    state: &mut MigrationState,
    id: &str,
    status: StepStatus,
    source_schema: u32,
    target_schema: u32,
    error_code: Option<String>,
) -> Result<(), String> {
    let manifest_digest = state.manifest_digest.clone();
    state.steps.insert(
        id.to_string(),
        MigrationStepState {
            status,
            source_schema,
            target_schema,
            updated_at_unix_ms: now_ms(),
            error_code,
            manifest_digest,
        },
    );
    save_state(state_path, state)
}

fn step_completed(state: &MigrationState, id: &str) -> bool {
    state
        .steps
        .get(id)
        .is_some_and(|step| step.status == StepStatus::Completed)
}

/// Derive the committed schema exclusively from completed migration steps.
/// This prevents a failed extension/DB reconciliation from leaving a false
/// success marker simply because a newer application binary started once.
fn recompute_committed_schema(state: &mut MigrationState) {
    const V1_STEPS: &[&str] = &[
        "layout_v1",
        "mobile_db_v1",
        "extensions_manifest_v1",
        "cli_v1",
        "assistant_ids_v1",
        "assistant_db_refs_v1",
        "mcp_names_v1",
    ];
    let v1_complete = V1_STEPS.iter().all(|id| step_completed(state, id));
    let v2_complete = v1_complete && step_completed(state, "remote_only_v2");
    let v3_complete = v2_complete && step_completed(state, "cleanup_v3");
    state.data_schema = if v3_complete {
        3
    } else if v2_complete {
        2
    } else if v1_complete {
        1
    } else {
        0
    };
}

fn config_candidates(base: &Path) -> Vec<PathBuf> {
    DATA_LAYOUT_NAMES
        .iter()
        .map(|name| base.join(name).join(CONFIGURATION_FILE_NAME))
        .collect()
}

fn parse_config(path: &Path) -> Option<AppConfiguration> {
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
}

fn configured_data_path(config_path: &Path, configuration: &AppConfiguration) -> PathBuf {
    let configured = PathBuf::from(&configuration.data_folder);
    if configured.is_absolute() {
        configured
    } else {
        config_path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(configured)
    }
}

fn is_known_default_data_dir(base: &Path, path: &Path) -> bool {
    DATA_LAYOUT_NAMES
        .iter()
        .any(|name| path == base.join(name).join("data"))
}

#[derive(Debug, Clone)]
struct DataSourceCandidate {
    identity: &'static str,
    path: PathBuf,
    has_supported_user_data: bool,
    has_substantive_user_data: bool,
}

fn configuration_candidates_for_identity(
    base: &Path,
    config_root: Option<&Path>,
    identity: &str,
) -> Vec<PathBuf> {
    let mut candidates = vec![base.join(identity).join(CONFIGURATION_FILE_NAME)];
    if let Some(config_root) = config_root {
        let candidate = config_root.join(identity).join(CONFIGURATION_FILE_NAME);
        if !candidates.contains(&candidate) {
            candidates.push(candidate);
        }
    }
    candidates
}

fn has_supported_user_data(path: &Path) -> Result<bool, String> {
    if !path.is_dir() {
        return Ok(false);
    }
    for name in USER_DATA_FILES {
        let candidate = path.join(name);
        if candidate.is_file() {
            return Ok(true);
        }
    }
    for name in USER_DATA_DIRS {
        let candidate = path.join(name);
        if !candidate.is_dir() {
            continue;
        }
        let mut entries =
            fs::read_dir(&candidate).map_err(|error| format!("inspect_data_source:{error}"))?;
        if entries
            .next()
            .transpose()
            .map_err(|error| format!("inspect_data_source_entry:{error}"))?
            .is_some()
        {
            return Ok(true);
        }
    }
    Ok(false)
}

fn has_substantive_user_data(path: &Path) -> Result<bool, String> {
    fn contains_meaningful_json(value: &Value) -> bool {
        match value {
            Value::Null => false,
            // An explicitly stored false/zero is still user configuration.
            Value::Bool(_) | Value::Number(_) => true,
            Value::String(value) => !value.trim().is_empty(),
            Value::Array(values) => values.iter().any(contains_meaningful_json),
            Value::Object(values) => values.values().any(contains_meaningful_json),
        }
    }

    fn contains_meaningful_entry(path: &Path) -> Result<bool, String> {
        for entry in fs::read_dir(path).map_err(|error| format!("inspect_data_source:{error}"))? {
            let entry = entry.map_err(|error| format!("inspect_data_source_entry:{error}"))?;
            let file_type = entry
                .file_type()
                .map_err(|error| format!("inspect_data_source_type:{error}"))?;
            if file_type.is_dir() {
                if contains_meaningful_entry(&entry.path())? {
                    return Ok(true);
                }
                continue;
            }
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if matches!(name.as_ref(), ".DS_Store" | "Thumbs.db" | ".gitkeep") {
                continue;
            }
            return Ok(true);
        }
        Ok(false)
    }

    if !path.is_dir() {
        return Ok(false);
    }
    for name in USER_DATA_FILES {
        let candidate = path.join(name);
        if !candidate.is_file() {
            continue;
        }
        let raw = fs::read_to_string(&candidate)
            .map_err(|error| format!("inspect_substantive_json:{}:{error}", candidate.display()))?;
        let mut value: Value = serde_json::from_str(&raw)
            .map_err(|_| format!("invalid_substantive_json:{}", candidate.display()))?;
        if *name == "store.json" {
            // `store.version` only records which binary started; it is not
            // evidence that the profile or any migration succeeded.
            if let Some(object) = value.as_object_mut() {
                object.remove("version");
            }
        }
        if contains_meaningful_json(&value) {
            return Ok(true);
        }
    }
    for name in USER_DATA_DIRS {
        let candidate = path.join(name);
        if !candidate.is_dir() {
            continue;
        }
        if contains_meaningful_entry(&candidate)? {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Enumerate configured and default directories per brand before moving to the
/// next brand. This preserves the required Biyan -> Mita -> Silence -> Jan ->
/// old bundle-id priority even when (for example) Silence uses a custom path.
fn discover_data_sources(
    base: &Path,
    config_root: Option<&Path>,
    recoverable_missing_path: Option<&Path>,
) -> Result<Vec<DataSourceCandidate>, String> {
    let mut sources = Vec::new();
    let mut seen = BTreeSet::new();
    for identity in DATA_LAYOUT_NAMES {
        for config_path in configuration_candidates_for_identity(base, config_root, identity) {
            if !config_path.exists() {
                continue;
            }
            let raw = fs::read_to_string(&config_path).map_err(|error| {
                format!("read_data_configuration:{}:{error}", config_path.display())
            })?;
            let configuration: AppConfiguration = serde_json::from_str(&raw)
                .map_err(|_| format!("invalid_data_configuration:{}", config_path.display()))?;
            if configuration.data_folder.trim().is_empty() {
                return Err(format!(
                    "empty_data_configuration:{}",
                    config_path.display()
                ));
            }
            let configured = configured_data_path(&config_path, &configuration);
            let recoverable = (recoverable_missing_path == Some(configured.as_path())
                || *identity == "Biyan")
                && data_migration_paths(&configured)
                    .ok()
                    .is_some_and(|(staging, backup)| staging.exists() || backup.exists());
            if !configured.is_dir() && !recoverable {
                return Err(format!(
                    "configured_data_folder_missing:{}",
                    configured.display()
                ));
            }
            if seen.insert(configured.clone()) {
                sources.push(DataSourceCandidate {
                    identity,
                    has_supported_user_data: configured.is_dir()
                        && has_supported_user_data(&configured)?,
                    has_substantive_user_data: configured.is_dir()
                        && has_substantive_user_data(&configured)?,
                    path: configured,
                });
            }
        }

        let default_data = base.join(identity).join("data");
        if default_data.is_dir() && seen.insert(default_data.clone()) {
            sources.push(DataSourceCandidate {
                identity,
                has_supported_user_data: has_supported_user_data(&default_data)?,
                has_substantive_user_data: has_substantive_user_data(&default_data)?,
                path: default_data,
            });
        }
    }
    Ok(sources)
}

fn copy_tree(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| format!("create_target:{e}"))?;
    for entry in fs::read_dir(source).map_err(|e| format!("read_source:{e}"))? {
        let entry = entry.map_err(|e| format!("read_entry:{e}"))?;
        let file_type = entry.file_type().map_err(|e| format!("file_type:{e}"))?;
        let destination = target.join(entry.file_name());
        if file_type.is_symlink() {
            return Err(format!(
                "unsupported_user_data_symlink:{}",
                entry.path().display()
            ));
        } else if file_type.is_dir() {
            copy_tree(&entry.path(), &destination)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), &destination).map_err(|e| format!("copy_file:{e}"))?;
            sync_copied_file(&destination).map_err(|e| format!("sync_copied_file:{e}"))?;
        } else {
            return Err(format!(
                "unsupported_user_data_file_type:{}",
                entry.path().display()
            ));
        }
    }
    #[cfg(unix)]
    fs::File::open(target)
        .and_then(|directory| directory.sync_all())
        .map_err(|e| format!("sync_copied_directory:{e}"))?;
    Ok(())
}

#[cfg(not(windows))]
fn sync_copied_file(path: &Path) -> io::Result<()> {
    fs::File::open(path)?.sync_all()
}

/// Flush a file copied by `CopyFileExW` without losing its original Windows
/// attributes or alternate data streams. `FlushFileBuffers` requires a handle
/// opened with `GENERIC_WRITE`, even when the copied file is read-only.
#[cfg(windows)]
fn sync_copied_file(path: &Path) -> io::Result<()> {
    let original_permissions = fs::metadata(path)?.permissions();
    if !original_permissions.readonly() {
        return OpenOptions::new()
            .read(true)
            .write(true)
            .open(path)?
            .sync_all();
    }

    let mut writable_permissions = original_permissions.clone();
    writable_permissions.set_readonly(false);
    fs::set_permissions(path, writable_permissions)?;

    let file = match OpenOptions::new().read(true).write(true).open(path) {
        Ok(file) => file,
        Err(open_error) => {
            return match fs::set_permissions(path, original_permissions) {
                Ok(()) => Err(open_error),
                Err(restore_error) => Err(io::Error::new(
                    restore_error.kind(),
                    format!(
                        "restore copied file permissions after open error: {restore_error}; open error: {open_error}"
                    ),
                )),
            };
        }
    };

    // Restore read-only while the writable handle is still valid, then flush
    // again so both copied content and restored metadata are durable.
    let content_sync = file.sync_all();
    let restore_permissions = file
        .set_permissions(original_permissions.clone())
        .or_else(|handle_error| {
            fs::set_permissions(path, original_permissions).map_err(|path_error| {
                io::Error::new(
                    path_error.kind(),
                    format!(
                        "restore copied file permissions by handle/path: {handle_error}; {path_error}"
                    ),
                )
            })
        });
    if let Err(restore_error) = restore_permissions {
        let message = match &content_sync {
            Ok(()) => format!("restore copied file permissions: {restore_error}"),
            Err(sync_error) => format!(
                "restore copied file permissions: {restore_error}; prior sync error: {sync_error}"
            ),
        };
        return Err(io::Error::new(restore_error.kind(), message));
    }
    let metadata_sync = file.sync_all();
    content_sync?;
    metadata_sync
}

fn hash_file(path: &Path) -> Result<(u64, String), String> {
    let mut file = fs::File::open(path).map_err(|e| format!("hash_open:{e}"))?;
    let size = file
        .metadata()
        .map_err(|e| format!("hash_metadata:{e}"))?
        .len();
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|e| format!("hash_read:{e}"))?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok((size, format!("{:x}", digest.finalize())))
}

fn add_tree_to_manifest(
    root: &Path,
    current: &Path,
    manifest: &mut BTreeMap<String, (u64, String)>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| format!("manifest_read:{e}"))? {
        let entry = entry.map_err(|e| format!("manifest_entry:{e}"))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("manifest_type:{e}"))?;
        if file_type.is_symlink() {
            return Err(format!(
                "unsupported_user_data_symlink:{}",
                entry.path().display()
            ));
        }
        if file_type.is_dir() {
            add_tree_to_manifest(root, &entry.path(), manifest)?;
            continue;
        }
        if !file_type.is_file() {
            return Err(format!(
                "unsupported_user_data_file_type:{}",
                entry.path().display()
            ));
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|e| format!("manifest_relative:{e}"))?
            .to_string_lossy()
            .replace('\\', "/");
        manifest.insert(relative, hash_file(&entry.path())?);
    }
    Ok(())
}

fn supported_user_data_manifest(root: &Path) -> Result<BTreeMap<String, (u64, String)>, String> {
    let mut manifest = BTreeMap::new();
    for name in USER_DATA_DIRS {
        let path = root.join(name);
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            return Err(format!("unsupported_user_data_symlink:{}", path.display()));
        }
        if !metadata.file_type().is_dir() {
            return Err(format!(
                "unsupported_user_data_file_type:{}",
                path.display()
            ));
        }
        add_tree_to_manifest(root, &path, &mut manifest)?;
    }
    for name in USER_DATA_FILES {
        let path = root.join(name);
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            return Err(format!("unsupported_user_data_symlink:{}", path.display()));
        }
        if !metadata.file_type().is_file() {
            return Err(format!(
                "unsupported_user_data_file_type:{}",
                path.display()
            ));
        }
        manifest.insert((*name).to_string(), hash_file(&path)?);
    }
    Ok(manifest)
}

fn supported_user_data_size(source: &Path) -> Result<u64, String> {
    fn tree_size(path: &Path) -> Result<u64, String> {
        let mut total = 0u64;
        for entry in fs::read_dir(path).map_err(|e| format!("size_source:{e}"))? {
            let entry = entry.map_err(|e| format!("size_entry:{e}"))?;
            let file_type = entry
                .file_type()
                .map_err(|e| format!("size_file_type:{e}"))?;
            if file_type.is_dir() {
                total = total.saturating_add(tree_size(&entry.path())?);
            } else if file_type.is_file() {
                total = total.saturating_add(
                    entry
                        .metadata()
                        .map_err(|e| format!("size_metadata:{e}"))?
                        .len(),
                );
            }
        }
        Ok(total)
    }

    let mut total = 0u64;
    for name in USER_DATA_DIRS {
        let path = source.join(name);
        if path.is_dir() {
            total = total.saturating_add(tree_size(&path)?);
        }
    }
    for name in USER_DATA_FILES {
        let path = source.join(name);
        if path.is_file() {
            total = total.saturating_add(
                path.metadata()
                    .map_err(|e| format!("size_metadata:{e}"))?
                    .len(),
            );
        }
    }
    Ok(total)
}

fn preflight_disk_space(source: &Path, destination_parent: &Path) -> Result<(), String> {
    const SAFETY_MARGIN: u64 = 64 * 1024 * 1024;
    let required = supported_user_data_size(source)?.saturating_add(SAFETY_MARGIN);
    let available =
        fs2::available_space(destination_parent).map_err(|e| format!("disk_space_check:{e}"))?;
    if available < required {
        return Err(format!(
            "insufficient_disk_space:required={required}:available={available}"
        ));
    }
    Ok(())
}

fn copy_supported_user_data(source: &Path, staging: &Path) -> Result<(), String> {
    let before = supported_user_data_manifest(source)?;
    fs::create_dir_all(staging).map_err(|e| format!("create_staging:{e}"))?;
    for name in USER_DATA_DIRS {
        let from = source.join(name);
        if from.is_dir() {
            copy_tree(&from, &staging.join(name))?;
        }
    }
    for name in USER_DATA_FILES {
        let from = source.join(name);
        if from.is_file() {
            let destination = staging.join(name);
            fs::copy(&from, &destination).map_err(|e| format!("copy_user_file:{e}"))?;
            sync_copied_file(&destination).map_err(|e| format!("sync_copied_file:{e}"))?;
        }
    }
    let after = supported_user_data_manifest(source)?;
    if before != after {
        return Err("source_changed_during_migration".to_string());
    }
    let copied = supported_user_data_manifest(staging)?;
    if before != copied {
        return Err("staging_manifest_mismatch".to_string());
    }
    #[cfg(unix)]
    fs::File::open(staging)
        .and_then(|directory| directory.sync_all())
        .map_err(|e| format!("sync_staging:{e}"))?;
    Ok(())
}

fn validate_json_tree(root: &Path) -> Result<(), String> {
    for name in USER_DATA_FILES {
        let path = root.join(name);
        if !path.is_file() {
            continue;
        }
        let raw = fs::read_to_string(&path).map_err(|e| format!("read_json:{e}"))?;
        serde_json::from_str::<Value>(&raw).map_err(|_| "invalid_json".to_string())?;
    }
    for name in ["threads", "assistants", "novels"] {
        validate_json_content_tree(&root.join(name))?;
    }
    Ok(())
}

fn validate_json_content_tree(root: &Path) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|e| format!("validate_read:{e}"))? {
        let entry = entry.map_err(|e| format!("validate_entry:{e}"))?;
        let path = entry.path();
        if path.is_dir() {
            validate_json_content_tree(&path)?;
            continue;
        }
        match path.extension().and_then(|ext| ext.to_str()) {
            Some("json") => {
                let raw = fs::read_to_string(&path).map_err(|e| format!("read_json:{e}"))?;
                serde_json::from_str::<Value>(&raw).map_err(|_| "invalid_json".to_string())?;
            }
            Some("jsonl") => {
                let raw = fs::read_to_string(&path).map_err(|e| format!("read_jsonl:{e}"))?;
                for line in raw.lines().filter(|line| !line.trim().is_empty()) {
                    serde_json::from_str::<Value>(line).map_err(|_| "invalid_jsonl".to_string())?;
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub(crate) fn normalize_reference_value(
    value: &mut Value,
    assistant_map: &BTreeMap<String, String>,
) {
    let Some(object) = value.as_object_mut() else {
        return;
    };

    // Only rewrite schema-owned reference fields. Message content, tool
    // results, attachments, metadata, and arbitrary user payloads may legally
    // contain an `assistant_id` key and must remain byte-semantically intact.
    for key in ["assistant_id", "assistantId", "defaultAssistantId"] {
        if let Some(Value::String(id)) = object.get_mut(key) {
            if let Some(replacement) = assistant_map.get(id) {
                *id = replacement.clone();
            }
        }
    }
    if let Some(Value::Array(assistants)) = object.get_mut("assistants") {
        for assistant in assistants {
            let Some(assistant) = assistant.as_object_mut() else {
                continue;
            };
            let Some(id) = assistant.get("id").and_then(Value::as_str) else {
                continue;
            };
            if let Some(replacement) = assistant_map.get(id) {
                assistant.insert("id".to_string(), Value::String(replacement.clone()));
            }
        }
    }
}

#[cfg(feature = "mobile")]
pub async fn prepare_mobile_database(app_data_dir: &Path, db_path: &Path) -> Result<(), String> {
    async fn inspect_database(path: &Path) -> Result<(bool, usize, u64), String> {
        if fs::metadata(path)
            .map_err(|error| format!("mobile_db_metadata:{error}"))?
            .len()
            == 0
        {
            return Ok((false, 0, 0));
        }
        let url = format!("sqlite:{}", path.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str(&url)
                    .map_err(|error| format!("mobile_db_url:{error}"))?
                    .read_only(true),
            )
            .await
            .map_err(|error| format!("open_mobile_db:{error}"))?;
        let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&pool)
            .await
            .map_err(|error| format!("validate_mobile_db:{error}"))?;
        if integrity != "ok" {
            pool.close().await;
            return Err(format!("mobile_db_integrity:{integrity}"));
        }
        let required_tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('threads', 'messages')",
        )
        .fetch_one(&pool)
        .await
        .map_err(|error| format!("inspect_mobile_db_schema:{error}"))?;
        let user_tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .fetch_one(&pool)
        .await
        .map_err(|error| format!("inspect_mobile_db_tables:{error}"))?;
        let mut rows = 0u64;
        for table in ["threads", "messages"] {
            let exists: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
            )
            .bind(table)
            .fetch_one(&pool)
            .await
            .map_err(|error| format!("inspect_mobile_db_table:{error}"))?;
            if exists == 1 {
                let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                    .fetch_one(&pool)
                    .await
                    .map_err(|error| format!("inspect_mobile_db_rows:{table}:{error}"))?;
                rows = rows.saturating_add(count.max(0) as u64);
            }
        }
        pool.close().await;
        Ok((required_tables == 2, user_tables.max(0) as usize, rows))
    }

    // Inspect in strict Biyan -> Mita -> Jan order and stop as soon as a
    // substantive higher-priority database is found. A corrupt *lower*
    // priority database must not block a valid selected source; conversely, a
    // corrupt database at the point where it would be selected fails closed.
    let canonical = if db_path.is_file() {
        Some(inspect_database(db_path).await?)
    } else {
        None
    };
    if let Some((ready, _, rows)) = canonical {
        if ready && rows > 0 {
            return Ok(());
        }
        if !ready && rows > 0 {
            return Err("partial_biyan_mobile_db_schema".to_string());
        }
    }

    let mut empty_legacy = None;
    let mut substantive_legacy = None;
    for name in ["mita.db", "jan.db"] {
        let path = app_data_dir.join(name);
        if !path.is_file() {
            continue;
        }
        let (ready, _, rows) = inspect_database(&path).await?;
        if !ready {
            return Err(format!(
                "legacy_mobile_db_missing_required_tables:{}",
                path.display()
            ));
        }
        if rows > 0 {
            substantive_legacy = Some(path);
            break;
        }
        if empty_legacy.is_none() {
            empty_legacy = Some(path);
        }
    }
    let has_substantive_legacy = substantive_legacy.is_some();
    let legacy_path = substantive_legacy.or(empty_legacy);

    if canonical.is_some() {
        if !has_substantive_legacy {
            // A fresh database may have crashed between CREATE statements.
            // Empty complete or partial schemas are safe to complete
            // idempotently in the transaction owned by threads/db.rs.
            return Ok(());
        }
        let empty_backup = app_data_dir.join("biyan.db.preexisting-empty");
        if empty_backup.exists() {
            return Err("preexisting_empty_mobile_db_backup_conflict".to_string());
        }
        fs::rename(db_path, &empty_backup)
            .map_err(|error| format!("backup_empty_biyan_mobile_db:{error}"))?;
        sync_parent_directory(db_path)?;
    }

    if let Some(legacy_path) = legacy_path {
        let staging_path = app_data_dir.join("biyan.db.migrating");
        let _ = fs::remove_file(&staging_path);
        let legacy_url = format!("sqlite:{}", legacy_path.display());
        let legacy_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str(&legacy_url)
                    .map_err(|e| format!("legacy_mobile_db_url:{e}"))?
                    .read_only(true),
            )
            .await
            .map_err(|e| format!("open_legacy_mobile_db:{e}"))?;

        let escaped = staging_path.to_string_lossy().replace('\'', "''");
        sqlx::query(&format!("VACUUM INTO '{escaped}'"))
            .execute(&legacy_pool)
            .await
            .map_err(|e| format!("backup_legacy_mobile_db:{e}"))?;
        legacy_pool.close().await;

        let staging_url = format!("sqlite:{}", staging_path.display());
        let staging_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str(&staging_url)
                    .map_err(|e| format!("staging_mobile_db_url:{e}"))?
                    .read_only(true),
            )
            .await
            .map_err(|e| format!("open_staging_mobile_db:{e}"))?;
        let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&staging_pool)
            .await
            .map_err(|e| format!("validate_staging_mobile_db:{e}"))?;
        let required_tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('threads', 'messages')",
        )
        .fetch_one(&staging_pool)
        .await
        .map_err(|e| format!("validate_staging_mobile_schema:{e}"))?;
        staging_pool.close().await;
        if integrity != "ok" || required_tables != 2 {
            let _ = fs::remove_file(&staging_path);
            return Err(format!(
                "legacy_mobile_db_integrity:{integrity}:required_tables={required_tables}"
            ));
        }
        OpenOptions::new()
            .read(true)
            .write(true)
            .open(&staging_path)
            .and_then(|file| file.sync_all())
            .map_err(|error| format!("sync_staging_mobile_db:{error}"))?;
        atomic_replace(&staging_path, db_path)
            .map_err(|error| format!("commit_mobile_db:{error}"))?;
        sync_parent_directory(db_path)?;
    }
    Ok(())
}

#[cfg(feature = "mobile")]
pub async fn migrate_mobile_assistant_references(
    pool: &SqlitePool,
    assistant_map: &BTreeMap<String, String>,
) -> Result<(), String> {
    if assistant_map.is_empty() {
        return Err("missing_assistant_id_mapping".to_string());
    }
    let mut transaction = pool
        .begin()
        .await
        .map_err(|error| format!("begin_mobile_assistant_migration:{error}"))?;
    for (select_sql, update_sql) in [
        (
            "SELECT id, data FROM threads",
            "UPDATE threads SET data = ?1 WHERE id = ?2",
        ),
        (
            "SELECT id, data FROM messages",
            "UPDATE messages SET data = ?1 WHERE id = ?2",
        ),
    ] {
        let rows = sqlx::query(select_sql)
            .fetch_all(&mut *transaction)
            .await
            .map_err(|e| format!("read_mobile_assistant_references:{e}"))?;
        for row in rows {
            let id: String = row.get("id");
            let data: String = row.get("data");
            let mut value: Value =
                serde_json::from_str(&data).map_err(|e| format!("validate_mobile_row:{id}:{e}"))?;
            let original = value.clone();
            normalize_reference_value(&mut value, &assistant_map);
            if value != original {
                let migrated = serde_json::to_string(&value)
                    .map_err(|e| format!("serialize_mobile_row:{id}:{e}"))?;
                sqlx::query(update_sql)
                    .bind(migrated)
                    .bind(&id)
                    .execute(&mut *transaction)
                    .await
                    .map_err(|e| format!("migrate_mobile_row:{id}:{e}"))?;
            }
        }
    }
    transaction
        .commit()
        .await
        .map_err(|error| format!("commit_mobile_assistant_migration:{error}"))?;
    let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(pool)
        .await
        .map_err(|error| format!("validate_mobile_assistant_migration:{error}"))?;
    if integrity != "ok" {
        return Err(format!("mobile_assistant_migration_integrity:{integrity}"));
    }
    Ok(())
}

fn rewrite_json_file(path: &Path, assistant_map: &BTreeMap<String, String>) -> Result<(), String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read_json:{e}"))?;
    let mut value: Value = serde_json::from_str(&raw).map_err(|_| "invalid_json".to_string())?;
    normalize_reference_value(&mut value, assistant_map);
    atomic_write(
        path,
        &serde_json::to_vec_pretty(&value).map_err(|e| format!("serialize_json:{e}"))?,
    )
}

fn rewrite_jsonl_file(path: &Path, assistant_map: &BTreeMap<String, String>) -> Result<(), String> {
    let raw = fs::read_to_string(path).map_err(|e| format!("read_jsonl:{e}"))?;
    let mut output = String::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let mut value: Value =
            serde_json::from_str(line).map_err(|_| "invalid_jsonl".to_string())?;
        normalize_reference_value(&mut value, assistant_map);
        output
            .push_str(&serde_json::to_string(&value).map_err(|e| format!("serialize_jsonl:{e}"))?);
        output.push('\n');
    }
    atomic_write(path, output.as_bytes())
}

fn rewrite_reference_tree(
    root: &Path,
    assistant_map: &BTreeMap<String, String>,
) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|e| format!("rewrite_read:{e}"))? {
        let entry = entry.map_err(|e| format!("rewrite_entry:{e}"))?;
        let path = entry.path();
        if path.is_dir() {
            rewrite_reference_tree(&path, assistant_map)?;
        } else {
            match path.extension().and_then(|ext| ext.to_str()) {
                Some("json") => rewrite_json_file(&path, assistant_map)?,
                Some("jsonl") => rewrite_jsonl_file(&path, assistant_map)?,
                _ => {}
            }
        }
    }
    Ok(())
}

fn looks_like_unmodified_stock_assistant(value: &Value, directory_id: &str) -> bool {
    let Some(object) = value.as_object() else {
        // A directory without assistant.json may still contain user assets.
        // There is no stock fingerprint, so preserve it as a custom import.
        return false;
    };
    let allowed = BTreeSet::from([
        "id",
        "name",
        "description",
        "instructions",
        "created_at",
        "updated_at",
        "parameters",
        "avatar",
        "thread_location",
        "object",
        "model",
        "tools",
        "file_ids",
        "metadata",
    ]);
    if object.keys().any(|key| !allowed.contains(key.as_str())) {
        return false;
    }

    if !LEGACY_DEFAULT_ASSISTANT_IDS.contains(&directory_id)
        || object.get("id").and_then(Value::as_str) != Some(directory_id)
    {
        return false;
    }
    if object.get("avatar").and_then(Value::as_str) != Some("👋")
        || object
            .get("object")
            .is_some_and(|value| value.as_str() != Some("assistant"))
        || object
            .get("model")
            .is_some_and(|value| value.as_str() != Some("*"))
        || object
            .get("thread_location")
            .is_some_and(|value| !value.is_null())
        || object.get("metadata").is_some_and(|value| !value.is_null())
        || object
            .get("file_ids")
            .is_some_and(|value| value.as_array().is_none_or(|items| !items.is_empty()))
    {
        return false;
    }

    for timestamp in ["created_at", "updated_at"] {
        if object.get(timestamp).is_some_and(|value| {
            value
                .as_f64()
                .is_none_or(|number| !number.is_finite() || number < 0.0)
        }) {
            return false;
        }
    }

    let stock_retrieval_tools = json!([{
        "type": "retrieval",
        "enabled": false,
        "useTimeWeightedRetriever": false,
        "settings": {
            "top_k": 2,
            "chunk_size": 1024,
            "chunk_overlap": 64,
            "retrieval_template": "Use the following pieces of context to answer the question at the end.\n----------------\nCONTEXT: {CONTEXT}\n----------------\nQUESTION: {QUESTION}\n----------------\nHelpful Answer:"
        }
    }]);
    if object
        .get("tools")
        .is_some_and(|value| value != &stock_retrieval_tools)
    {
        return false;
    }
    if let Some(parameters) = object.get("parameters") {
        let stock_four = json!({
            "temperature": 0.7,
            "top_k": 20,
            "top_p": 0.8,
            "repeat_penalty": 1.12
        });
        let stock_six = json!({
            "temperature": 0.7,
            "top_k": 20,
            "top_p": 0.8,
            "repeat_penalty": 1.12,
            "auto_compact": true,
            "auto_compact_threshold": 0.85
        });
        if parameters != &stock_four && parameters != &stock_six {
            return false;
        }
    }

    let Some(name) = object.get("name").and_then(Value::as_str) else {
        return false;
    };
    let Some(description) = object.get("description").and_then(Value::as_str) else {
        return false;
    };
    let Some(instructions) = object.get("instructions").and_then(Value::as_str) else {
        return false;
    };
    let hash = |text: &str| {
        let mut digest = Sha256::new();
        digest.update(text.as_bytes());
        format!("{:x}", digest.finalize())
    };
    let description_hash = hash(description);
    let instructions_hash = hash(instructions);
    matches!(
        (name, description_hash.as_str(), instructions_hash.as_str()),
        (
            "Mita",
            "813c0a871b478022aba7b1eb7454e35bc18021e8f59b48cf50a4b3307d973973",
            "877d813ad5137d38677f2287ff2d61955c923c8860873b40f1a308751fa26ca9"
        ) | (
            "Biyan",
            "981c07d5ad1769c66b3f729b798708e1f4d5e9c13d8f753500d5929e1591d732",
            "d3abfc2bc85bea7ba2bbf112c73036db20bf25820d62cb8d48080edbc8d59503"
        ) | (
            "Silence",
            "5478354ca610feaa6556e099c8ab3c3f9144d8970a2dce39a8bbf90224a3779d",
            "05c006fbe265736518ec8e3f0a35ab023e5e3fc30a90f67d87819b240a5658bf"
        ) | (
            "Jan",
            "d48d02ca9c1269a395a42939f397d643fd300be34a2d0ba2030e758834e4ba20",
            "a401437713c714f15a7f3ea5b8b106ff8ca8a8961d5d66aec3fea1ffb3ea27bc"
        ) | (
            "Jan",
            "427ec08d8b9fcd5ce137b5fcf32b7ca32eaf5c312e92152e51a435dc6548b8c1",
            "a401437713c714f15a7f3ea5b8b106ff8ca8a8961d5d66aec3fea1ffb3ea27bc"
        )
    )
}

fn migrate_assistant_ids(data_dir: &Path) -> Result<BTreeMap<String, String>, String> {
    let assistants = data_dir.join("assistants");
    if !assistants.is_dir() {
        let mapping = LEGACY_DEFAULT_ASSISTANT_IDS
            .iter()
            .map(|id| ((*id).to_string(), "biyan".to_string()))
            .collect::<BTreeMap<_, _>>();
        rewrite_reference_tree(&data_dir.join("threads"), &mapping)?;
        for name in ["settings.json", "store.json"] {
            let path = data_dir.join(name);
            if path.is_file() {
                rewrite_json_file(&path, &mapping)?;
            }
        }
        return Ok(mapping);
    }

    let mut mapping = BTreeMap::new();
    let mut canonical_exists = assistants.join("biyan").exists();
    for legacy_id in LEGACY_DEFAULT_ASSISTANT_IDS {
        let legacy_dir = assistants.join(legacy_id);
        if !legacy_dir.exists() {
            // A previous process may have crashed after the directory rename
            // but before thread references and the step marker were committed.
            // Recover the deterministic imported ID instead of silently
            // redirecting those threads to the stock Biyan assistant.
            let imported_id = format!("legacy-import-{legacy_id}");
            let imported_dir = assistants.join(&imported_id);
            let mut suffixed_imports = fs::read_dir(&assistants)
                .map_err(|e| format!("read_assistants_for_recovery:{e}"))?
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .filter_map(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    name.starts_with(&format!("{imported_id}-"))
                        .then_some((name, entry.path()))
                })
                .collect::<Vec<_>>();
            suffixed_imports.sort_by(|left, right| left.0.cmp(&right.0));
            let recovered = match suffixed_imports.as_slice() {
                [] if imported_dir.is_dir() => Some((imported_id, imported_dir)),
                [] => None,
                [single] => Some(single.clone()),
                _ => return Err(format!("ambiguous_imported_assistant:{legacy_id}")),
            };
            if let Some((recovered_id, recovered_dir)) = recovered {
                rewrite_assistant_id(&recovered_dir, &recovered_id)?;
                mapping.insert((*legacy_id).to_string(), recovered_id);
            } else {
                mapping.insert((*legacy_id).to_string(), "biyan".to_string());
            }
            continue;
        }

        let assistant_json = legacy_dir.join("assistant.json");
        let legacy_assistant: Value = if assistant_json.is_file() {
            serde_json::from_slice(
                &fs::read(&assistant_json).map_err(|e| format!("read_assistant:{e}"))?,
            )
            .map_err(|_| "invalid_assistant_json".to_string())?
        } else {
            Value::Null
        };
        let looks_like_stock_default =
            looks_like_unmodified_stock_assistant(&legacy_assistant, legacy_id);

        let mut target_id = if looks_like_stock_default && !canonical_exists {
            canonical_exists = true;
            "biyan".to_string()
        } else if looks_like_stock_default {
            "biyan".to_string()
        } else {
            format!("legacy-import-{legacy_id}")
        };
        let mut target_dir = assistants.join(&target_id);
        if !looks_like_stock_default && target_dir.exists() {
            // Preserve both assistants on a real name collision. The suffix is
            // content-derived, so retries and direct current -> C installs pick
            // the same ID without relying on directory iteration order.
            let mut digest = Sha256::new();
            digest.update(
                serde_json::to_vec(&legacy_assistant)
                    .map_err(|e| format!("serialize_legacy_assistant_for_id:{e}"))?,
            );
            let suffix = format!("{:x}", digest.finalize());
            target_id = format!("legacy-import-{legacy_id}-{}", &suffix[..12]);
            target_dir = assistants.join(&target_id);
        }
        if !target_dir.exists() {
            fs::rename(&legacy_dir, &target_dir)
                .map_err(|e| format!("rename_legacy_assistant:{e}"))?;
        } else if looks_like_stock_default {
            fs::remove_dir_all(&legacy_dir)
                .map_err(|e| format!("remove_stock_legacy_assistant:{e}"))?;
        }
        rewrite_assistant_id(&target_dir, &target_id)?;
        mapping.insert((*legacy_id).to_string(), target_id);
    }

    rewrite_reference_tree(&data_dir.join("threads"), &mapping)?;
    for name in ["settings.json", "store.json"] {
        let path = data_dir.join(name);
        if path.is_file() {
            rewrite_json_file(&path, &mapping)?;
        }
    }
    Ok(mapping)
}

fn rewrite_assistant_id(target_dir: &Path, target_id: &str) -> Result<(), String> {
    let assistant_json = target_dir.join("assistant.json");
    if !assistant_json.is_file() {
        return Ok(());
    }
    let raw = fs::read_to_string(&assistant_json).map_err(|e| format!("read_assistant:{e}"))?;
    let mut value: Value =
        serde_json::from_str(&raw).map_err(|_| "invalid_assistant_json".to_string())?;
    if let Some(object) = value.as_object_mut() {
        object.insert("id".to_string(), Value::String(target_id.to_string()));
    }
    atomic_write(
        &assistant_json,
        &serde_json::to_vec_pretty(&value).map_err(|e| format!("serialize_assistant:{e}"))?,
    )
}

fn normalize_mcp_runtime(value: &mut Value) {
    match value {
        Value::Object(object) => {
            if let Some(Value::String(command)) = object.get_mut("command") {
                if command == "mita-web-research" || command == "jan-web-research" {
                    *command = "biyan-web-research".to_string();
                }
            }
            if let Some(Value::Object(env)) = object.get_mut("env") {
                let old_keys: Vec<String> = env.keys().cloned().collect();
                for key in old_keys {
                    let replacement = if let Some(suffix) = key.strip_prefix("MITA_WEB_RESEARCH_") {
                        Some(format!("BIYAN_WEB_RESEARCH_{suffix}"))
                    } else {
                        key.strip_prefix("JAN_WEB_RESEARCH_")
                            .map(|suffix| format!("BIYAN_WEB_RESEARCH_{suffix}"))
                    };
                    if let Some(replacement) = replacement {
                        if !env.contains_key(&replacement) {
                            if let Some(value) = env.get(&key).cloned() {
                                env.insert(replacement, value);
                            }
                        }
                        env.remove(&key);
                    }
                }
            }
            for nested in object.values_mut() {
                normalize_mcp_runtime(nested);
            }
        }
        Value::Array(values) => {
            for nested in values {
                normalize_mcp_runtime(nested);
            }
        }
        _ => {}
    }
}

fn migrate_mcp_config(data_dir: &Path) -> Result<(), String> {
    let path = data_dir.join("mcp_config.json");
    if !path.is_file() {
        return Ok(());
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read_mcp:{e}"))?;
    let mut value: Value =
        serde_json::from_str(&raw).map_err(|_| "invalid_mcp_json".to_string())?;
    if let Some(servers) = value.get_mut("mcpServers").and_then(Value::as_object_mut) {
        normalize_browser_mcp_server_key(servers);
    }
    normalize_mcp_runtime(&mut value);
    atomic_write(
        &path,
        &serde_json::to_vec_pretty(&value).map_err(|e| format!("serialize_mcp:{e}"))?,
    )
}

fn data_migration_paths(target: &Path) -> Result<(PathBuf, PathBuf), String> {
    let parent = target
        .parent()
        .ok_or_else(|| "migration_target_missing_parent".to_string())?;
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "migration_target_invalid_name".to_string())?;
    Ok((
        parent.join(format!(".{name}.biyan-migrating")),
        parent.join(format!(".{name}.biyan-legacy-backup")),
    ))
}

fn sync_parent_directory(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let parent = path
            .parent()
            .ok_or_else(|| "migration_target_missing_parent".to_string())?;
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| format!("sync_migration_parent:{error}"))?;
    }
    Ok(())
}

/// Build a fully validated canonical tree next to its destination and then
/// switch it in with same-filesystem renames. If the destination was also the
/// source (custom data folders), the original full tree becomes the immutable
/// sibling backup, including local-model/RAG assets which are intentionally not
/// copied into the remote-only canonical tree.
fn migrate_data_tree_atomically(source: &Path, target: &Path) -> Result<Option<PathBuf>, String> {
    let parent = target
        .parent()
        .ok_or_else(|| "migration_target_missing_parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("create_data_parent:{error}"))?;
    let (staging, backup) = data_migration_paths(target)?;
    let recovery_source = if source == target && backup.is_dir() {
        backup.as_path()
    } else {
        source
    };

    let verify_recovery_tree = |candidate: &Path| -> Result<(), String> {
        if !recovery_source.is_dir() {
            return Err(format!(
                "migration_recovery_source_missing:{}",
                recovery_source.display()
            ));
        }
        let expected = supported_user_data_manifest(recovery_source)?;
        let recovered = supported_user_data_manifest(candidate)?;
        if expected != recovered {
            return Err(format!(
                "migration_recovery_manifest_mismatch:{}",
                candidate.display()
            ));
        }
        validate_json_tree(candidate)
    };

    // Crash recovery after the original destination was moved aside. A valid
    // staging tree is always preferred; without one, restore the original and
    // restart the copy below.
    if backup.exists() && !target.exists() {
        if staging.exists() {
            verify_recovery_tree(&staging)?;
            fs::rename(&staging, target).map_err(|error| format!("resume_commit_data:{error}"))?;
            sync_parent_directory(target)?;
        } else {
            fs::rename(&backup, target).map_err(|error| format!("restore_legacy_data:{error}"))?;
            sync_parent_directory(target)?;
        }
    }

    // A prior attempt completed the swap but crashed before writing its state
    // marker. Never overwrite the original backup on retry.
    if backup.exists() && target.is_dir() {
        verify_recovery_tree(target)?;
        if staging.exists() {
            fs::remove_dir_all(&staging)
                .map_err(|error| format!("clean_committed_staging:{error}"))?;
        }
        return Ok(Some(backup));
    }

    if !source.is_dir() {
        return Err(format!("migration_source_missing:{}", source.display()));
    }
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|error| format!("clean_staging:{error}"))?;
    }
    preflight_disk_space(source, parent)?;
    copy_supported_user_data(source, &staging)?;
    validate_json_tree(&staging)?;

    let had_target = target.exists();
    if had_target {
        if backup.exists() {
            return Err(format!("legacy_backup_conflict:{}", backup.display()));
        }
        fs::rename(target, &backup).map_err(|error| format!("backup_legacy_data:{error}"))?;
    }
    if let Err(error) = fs::rename(&staging, target) {
        if had_target {
            let _ = fs::rename(&backup, target);
        }
        return Err(format!("commit_data:{error}"));
    }
    sync_parent_directory(target)?;
    Ok(had_target.then_some(backup))
}

fn run_assistant_step(
    state_path: &Path,
    state: &mut MigrationState,
    data_dir: &Path,
    staged_mapping: Option<BTreeMap<String, String>>,
) -> Result<(), String> {
    const ID: &str = "assistant_ids_v1";
    if step_completed(state, ID) && !state.assistant_id_map.is_empty() {
        return Ok(());
    }
    if !step_completed(state, ID) {
        set_step(state_path, state, ID, StepStatus::Running, 0, 1, None)?;
    }
    let mapping = match staged_mapping {
        Some(mapping) => Ok(mapping),
        None => migrate_assistant_ids(data_dir),
    };
    match mapping {
        Ok(mapping) => {
            state.assistant_id_map = mapping;
            let manifest_digest = state.manifest_digest.clone();
            state.steps.insert(
                ID.to_string(),
                MigrationStepState {
                    status: StepStatus::Completed,
                    source_schema: 0,
                    target_schema: 1,
                    updated_at_unix_ms: now_ms(),
                    error_code: None,
                    manifest_digest,
                },
            );
            save_state(state_path, state)
        }
        Err(error) => {
            let code = error
                .split(':')
                .next()
                .unwrap_or("assistant_migration_failed")
                .to_string();
            let _ = set_step(state_path, state, ID, StepStatus::Failed, 0, 1, Some(code));
            Err(error)
        }
    }
}

fn run_step<F>(
    state_path: &Path,
    state: &mut MigrationState,
    id: &str,
    source_schema: u32,
    target_schema: u32,
    action: F,
) -> Result<(), String>
where
    F: FnOnce() -> Result<(), String>,
{
    if state
        .steps
        .get(id)
        .is_some_and(|step| step.status == StepStatus::Completed)
    {
        return Ok(());
    }
    set_step(
        state_path,
        state,
        id,
        StepStatus::Running,
        source_schema,
        target_schema,
        None,
    )?;
    match action() {
        Ok(()) => set_step(
            state_path,
            state,
            id,
            StepStatus::Completed,
            source_schema,
            target_schema,
            None,
        ),
        Err(error) => {
            let code = error
                .split(':')
                .next()
                .unwrap_or("migration_failed")
                .to_string();
            let _ = set_step(
                state_path,
                state,
                id,
                StepStatus::Failed,
                source_schema,
                target_schema,
                Some(code),
            );
            Err(error)
        }
    }
}

pub fn run_startup_migrations<R: Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<MigrationReport, String> {
    let base = app
        .path()
        .data_dir()
        .map_err(|e| format!("resolve_data_dir:{e}"))?;
    let app_version = app.config().version.clone().unwrap_or_default();
    let canonical_config_dir = base.join("Biyan");
    let manifest_digest = approved_manifest_digest(&canonical_config_dir, &app_version)?
        .unwrap_or_else(|| release_attestation_digest(&app_version));
    let config_root = app.path().config_dir().ok();
    run_migrations_to_schema_with_digest_and_config_root(
        &base,
        &app_version,
        compiled_target_data_schema(),
        Some(manifest_digest),
        config_root.as_deref(),
        true,
    )
}

pub fn run_migrations_in(base: &Path, app_version: &str) -> Result<MigrationReport, String> {
    run_migrations_to_schema(base, app_version, compiled_target_data_schema())
}

fn run_migrations_to_schema(
    base: &Path,
    app_version: &str,
    target_data_schema: u32,
) -> Result<MigrationReport, String> {
    run_migrations_to_schema_with_digest(base, app_version, target_data_schema, None)
}

fn run_migrations_to_schema_with_digest(
    base: &Path,
    app_version: &str,
    target_data_schema: u32,
    manifest_digest: Option<String>,
) -> Result<MigrationReport, String> {
    run_migrations_to_schema_with_digest_and_config_root(
        base,
        app_version,
        target_data_schema,
        manifest_digest,
        None,
        false,
    )
}

fn run_migrations_to_schema_with_digest_and_config_root(
    base: &Path,
    app_version: &str,
    target_data_schema: u32,
    manifest_digest: Option<String>,
    config_root: Option<&Path>,
    defer_post_layout: bool,
) -> Result<MigrationReport, String> {
    if !(1..=TARGET_DATA_SCHEMA).contains(&target_data_schema) {
        return Err(format!("unsupported_target_schema:{target_data_schema}"));
    }
    let canonical_config_dir = base.join("Biyan");
    let migration_lock = acquire_lock(&canonical_config_dir)?;
    let state_path = canonical_config_dir.join(STATE_FILE);
    let mut state = load_state(&state_path)?;
    if state.data_schema > target_data_schema {
        return Err(format!(
            "data_schema_downgrade_not_supported:{}:{}",
            state.data_schema, target_data_schema
        ));
    }
    state.source_app_version = app_version.to_string();
    state.manifest_digest = manifest_digest
        .or_else(|| {
            std::env::var("BIYAN_UPDATE_MANIFEST_DIGEST")
                .ok()
                .filter(|digest| !digest.trim().is_empty())
        })
        .or_else(|| Some(release_attestation_digest(app_version)));
    let initial_manifest_digest = state.manifest_digest.clone();
    for (id, source_schema, target_schema) in [
        ("layout_v1", 0, 1),
        ("mobile_db_v1", 0, 1),
        ("assistant_ids_v1", 0, 1),
        ("mcp_names_v1", 0, 1),
        ("extensions_manifest_v1", 0, 1),
        ("cli_v1", 0, 1),
        ("assistant_db_refs_v1", 0, 1),
        ("remote_only_v2", 1, 2),
        ("cleanup_v3", 2, 3),
    ] {
        state
            .steps
            .entry(id.to_string())
            .or_insert_with(|| MigrationStepState {
                status: StepStatus::Pending,
                source_schema,
                target_schema,
                updated_at_unix_ms: now_ms(),
                error_code: None,
                manifest_digest: initial_manifest_digest.clone(),
            });
    }
    save_state(&state_path, &state)?;

    let canonical_config = canonical_config_dir.join(CONFIGURATION_FILE_NAME);
    let layout_complete = step_completed(&state, "layout_v1");
    let layout_has_selected_source = state
        .steps
        .get("layout_v1")
        .is_some_and(|step| step.status != StepStatus::Pending)
        && state.selected_source.is_some();

    let recoverable_selected = state
        .steps
        .get("layout_v1")
        .is_some_and(|step| matches!(step.status, StepStatus::Running | StepStatus::Failed))
        .then(|| state.selected_source.as_deref())
        .flatten()
        .map(PathBuf::from);
    let discovered = if layout_complete {
        // The layout marker may have committed just before the retained-source
        // list. Best-effort rediscovery repairs that crash window without
        // allowing a stale lower-priority config to block an already committed
        // canonical layout.
        discover_data_sources(base, config_root, None).unwrap_or_default()
    } else {
        match discover_data_sources(base, config_root, recoverable_selected.as_deref()) {
            Ok(sources) => sources,
            Err(error) => {
                let code = error
                    .split(':')
                    .next()
                    .unwrap_or("data_source_discovery_failed")
                    .to_string();
                let _ = set_step(
                    &state_path,
                    &mut state,
                    "layout_v1",
                    StepStatus::Failed,
                    0,
                    1,
                    Some(code),
                );
                return Err(error);
            }
        }
    };

    // Read every Biyan configuration location and require agreement. This
    // avoids platform config roots silently redirecting writes to a different
    // data tree than the canonical data-dir configuration.
    let mut biyan_configurations = Vec::new();
    for path in configuration_candidates_for_identity(base, config_root, "Biyan") {
        if !path.exists() {
            continue;
        }
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("read_data_configuration:{}:{error}", path.display()))?;
        let configuration: AppConfiguration = serde_json::from_str(&raw)
            .map_err(|_| format!("invalid_data_configuration:{}", path.display()))?;
        if configuration.data_folder.trim().is_empty() {
            return Err(format!("empty_data_configuration:{}", path.display()));
        }
        biyan_configurations.push((path, configuration));
    }
    let configured_biyan_paths = biyan_configurations
        .iter()
        .map(|(path, configuration)| configured_data_path(path, configuration))
        .collect::<BTreeSet<_>>();
    if configured_biyan_paths.len() > 1 && (layout_complete || !layout_has_selected_source) {
        return Err("conflicting_biyan_data_configuration".to_string());
    }

    let selected = if layout_complete || layout_has_selected_source {
        state.selected_source.as_ref().map(PathBuf::from)
    } else {
        discovered
            .iter()
            .find(|source| source.has_substantive_user_data)
            .or_else(|| {
                discovered
                    .iter()
                    .find(|source| source.has_supported_user_data)
            })
            .map(|source| source.path.clone())
    };
    let selected_custom = selected
        .as_ref()
        .filter(|path| !is_known_default_data_dir(base, path))
        .cloned();
    let legacy_custom = discovered
        .iter()
        .find(|source| source.identity != "Biyan" && !is_known_default_data_dir(base, &source.path))
        .map(|source| source.path.clone());
    let canonical_data_dir = if layout_complete {
        configured_biyan_paths.iter().next().cloned()
    } else if selected_custom.is_some() {
        selected_custom
    } else if selected.is_none() && legacy_custom.is_some() {
        legacy_custom
    } else {
        configured_biyan_paths.iter().next().cloned()
    }
    .unwrap_or_else(|| canonical_config_dir.join("data"));

    if layout_complete && biyan_configurations.is_empty() {
        return Err("missing_biyan_data_configuration".to_string());
    }
    state.selected_source = selected
        .as_ref()
        .map(|path| path.to_string_lossy().into_owned());
    save_state(&state_path, &state)?;

    let mut migration_backup = None;
    run_step(&state_path, &mut state, "layout_v1", 0, 1, || {
        if let Some(source) = selected.as_ref() {
            migration_backup = migrate_data_tree_atomically(source, &canonical_data_dir)?;
        } else {
            fs::create_dir_all(&canonical_data_dir)
                .map_err(|error| format!("create_empty_data:{error}"))?;
            validate_json_tree(&canonical_data_dir)?;
        }

        let configuration = AppConfiguration {
            data_folder: canonical_data_dir.to_string_lossy().into_owned(),
        };
        let serialized = serde_json::to_vec_pretty(&configuration)
            .map_err(|e| format!("serialize_config:{e}"))?;
        let mut destinations = biyan_configurations
            .iter()
            .map(|(path, _)| path.clone())
            .collect::<Vec<_>>();
        push_unique_path(&mut destinations, canonical_config.clone());
        for destination in destinations {
            atomic_write(&destination, &serialized)?;
        }
        Ok(())
    })?;

    if !defer_post_layout {
        // Test/direct-installer mode performs every portable reconciliation in
        // one call. App startup defers these until DB, extensions and CLI have
        // committed in the required order.
        #[cfg(not(any(target_os = "android", target_os = "ios")))]
        run_step(&state_path, &mut state, "mobile_db_v1", 0, 1, || Ok(()))?;
        run_step(&state_path, &mut state, "cli_v1", 0, 1, || Ok(()))?;
        run_assistant_step(&state_path, &mut state, &canonical_data_dir, None)?;
        run_step(
            &state_path,
            &mut state,
            "assistant_db_refs_v1",
            0,
            1,
            || Ok(()),
        )?;
        run_step(&state_path, &mut state, "mcp_names_v1", 0, 1, || {
            migrate_mcp_config(&canonical_data_dir)
        })?;

        if target_data_schema >= 2 {
            run_step(&state_path, &mut state, "remote_only_v2", 1, 2, || Ok(()))?;
        }
    }

    recompute_committed_schema(&mut state);
    save_state(&state_path, &state)?;

    // Preserve the same deterministic priority in recovery UI and follow-up
    // commands. A sorted set would put Jan before Mita on some paths and could
    // open the wrong source. For an in-place custom migration the immutable
    // sibling backup is the real legacy source, not the now-canonical path.
    let prior_retained = state
        .retained_legacy_sources
        .iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    let backup = migration_backup.or_else(|| {
        data_migration_paths(&canonical_data_dir)
            .ok()
            .map(|(_, backup)| backup)
            .filter(|backup| backup.exists())
    });
    let mut retained = Vec::new();
    if let Some(selected) = selected.as_ref() {
        if selected != &canonical_data_dir && selected.exists() {
            push_unique_path(&mut retained, selected.clone());
        }
    }
    if let Some(backup) = backup {
        push_unique_path(&mut retained, backup);
    }
    for source in &discovered {
        if source.path != canonical_data_dir && source.path.exists() {
            push_unique_path(&mut retained, source.path.clone());
        }
    }
    for source in prior_retained {
        if source.exists() {
            push_unique_path(&mut retained, source);
        }
    }
    state.retained_legacy_sources = retained
        .iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    save_state(&state_path, &state)?;

    Ok(MigrationReport {
        target_data_schema,
        completed_data_schema: state.data_schema,
        canonical_config_dir,
        canonical_data_dir,
        retained_legacy_sources: retained,
        _lock: migration_lock,
    })
}

pub fn retained_legacy_sources_in(base: &Path) -> Result<Vec<PathBuf>, String> {
    let state = load_state(&base.join("Biyan").join(STATE_FILE))?;
    let retained = state
        .retained_legacy_sources
        .into_iter()
        .map(PathBuf::from)
        .filter(|path| path.exists())
        .collect::<Vec<_>>();
    if retained.is_empty() {
        Ok(discover_legacy_data_sources(base))
    } else {
        Ok(retained)
    }
}

pub fn assistant_id_map_in(config_dir: &Path) -> Result<BTreeMap<String, String>, String> {
    let state = load_state(&config_dir.join(STATE_FILE))?;
    if !step_completed(&state, "assistant_ids_v1") || state.assistant_id_map.is_empty() {
        return Err("assistant_id_migration_not_committed".to_string());
    }
    Ok(state.assistant_id_map)
}

#[tauri::command]
pub fn get_committed_assistant_id_map<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<BTreeMap<String, String>, String> {
    let config_dir = app
        .path()
        .data_dir()
        .map_err(|error| format!("resolve_assistant_migration_state:{error}"))?
        .join("Biyan");
    assistant_id_map_in(&config_dir)
}

pub fn record_retained_legacy_sources(
    config_dir: &Path,
    sources: impl IntoIterator<Item = PathBuf>,
) -> Result<(), String> {
    let state_path = config_dir.join(STATE_FILE);
    let mut state = load_state(&state_path)?;
    let mut retained = state
        .retained_legacy_sources
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();
    for source in sources.into_iter().filter(|path| path.exists()) {
        push_unique_path(&mut retained, source);
    }
    state.retained_legacy_sources = retained
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    save_state(&state_path, &state)
}

pub fn complete_assistant_migration(config_dir: &Path, data_dir: &Path) -> Result<(), String> {
    let state_path = config_dir.join(STATE_FILE);
    let mut state = load_state(&state_path)?;
    for prerequisite in [
        "layout_v1",
        "mobile_db_v1",
        "extensions_manifest_v1",
        "cli_v1",
    ] {
        if !step_completed(&state, prerequisite) {
            return Err(format!(
                "assistant_migration_prerequisite_pending:{prerequisite}"
            ));
        }
    }
    let mapping = (!state.assistant_id_map.is_empty()).then(|| state.assistant_id_map.clone());
    run_assistant_step(&state_path, &mut state, data_dir, mapping)
}

pub fn finalize_remote_only_migration(
    config_dir: &Path,
    target_data_schema: u32,
) -> Result<u32, String> {
    let state_path = config_dir.join(STATE_FILE);
    let mut state = load_state(&state_path)?;
    for prerequisite in [
        "layout_v1",
        "mobile_db_v1",
        "extensions_manifest_v1",
        "cli_v1",
        "assistant_ids_v1",
        "assistant_db_refs_v1",
        "mcp_names_v1",
    ] {
        if !step_completed(&state, prerequisite) {
            return Err(format!(
                "schema_migration_prerequisite_pending:{prerequisite}"
            ));
        }
    }
    if target_data_schema >= 2 {
        run_step(&state_path, &mut state, "remote_only_v2", 1, 2, || Ok(()))?;
    }
    recompute_committed_schema(&mut state);
    save_state(&state_path, &state)?;
    Ok(state.data_schema)
}

#[tauri::command]
pub fn list_retained_legacy_migration_sources<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<String>, String> {
    // The recovery page must still be useful when migration-state.json itself
    // is corrupt. Do not relax normal migration/cleanup parsing; only this
    // read-only listing falls back to deterministic legacy discovery.
    Ok(recovery_legacy_sources_for_app(&app)?
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

pub fn mark_component_migration(
    config_dir: &Path,
    component: &str,
    target_schema: u32,
) -> Result<(), String> {
    let state_path = config_dir.join(STATE_FILE);
    let mut state = load_state(&state_path)?;
    if state.steps.get(component).is_some_and(|step| {
        step.status == StepStatus::Completed && step.target_schema >= target_schema
    }) {
        if component == "extensions_manifest_v1" && state.extensions_schema < target_schema {
            state.extensions_schema = target_schema;
        }
        recompute_committed_schema(&mut state);
        return save_state(&state_path, &state);
    }
    let source_schema = state.data_schema;
    let manifest_digest = state.manifest_digest.clone();
    state.steps.insert(
        component.to_string(),
        MigrationStepState {
            status: StepStatus::Completed,
            source_schema,
            target_schema,
            updated_at_unix_ms: now_ms(),
            error_code: None,
            manifest_digest,
        },
    );
    if component == "extensions_manifest_v1" {
        state.extensions_schema = target_schema;
    }
    recompute_committed_schema(&mut state);
    save_state(&state_path, &state)
}

pub fn mark_component_migration_running(
    config_dir: &Path,
    component: &str,
    target_schema: u32,
) -> Result<(), String> {
    let state_path = config_dir.join(STATE_FILE);
    let mut state = load_state(&state_path)?;
    if state.steps.get(component).is_some_and(|step| {
        step.status == StepStatus::Completed && step.target_schema >= target_schema
    }) {
        return Ok(());
    }
    let source_schema = state.data_schema;
    let manifest_digest = state.manifest_digest.clone();
    state.steps.insert(
        component.to_string(),
        MigrationStepState {
            status: StepStatus::Running,
            source_schema,
            target_schema,
            updated_at_unix_ms: now_ms(),
            error_code: None,
            manifest_digest,
        },
    );
    recompute_committed_schema(&mut state);
    save_state(&state_path, &state)
}

pub fn mark_component_migration_failed(
    config_dir: &Path,
    component: &str,
    target_schema: u32,
    error: &str,
) -> Result<(), String> {
    let state_path = config_dir.join(STATE_FILE);
    let mut state = load_state(&state_path)?;
    if state.steps.get(component).is_some_and(|step| {
        step.status == StepStatus::Completed && step.target_schema >= target_schema
    }) {
        // A failed retry never invalidates an already committed migration. The
        // caller still fails closed for this startup and the atomic installer
        // leaves the last known-good component in place.
        return Ok(());
    }
    let source_schema = state.data_schema;
    let error_code = error
        .split(':')
        .next()
        .unwrap_or("component_migration_failed")
        .to_string();
    let manifest_digest = state.manifest_digest.clone();
    state.steps.insert(
        component.to_string(),
        MigrationStepState {
            status: StepStatus::Failed,
            source_schema,
            target_schema,
            updated_at_unix_ms: now_ms(),
            error_code: Some(error_code),
            manifest_digest,
        },
    );
    recompute_committed_schema(&mut state);
    save_state(&state_path, &state)
}

fn cleanup_modified_unix_nanos(metadata: &fs::Metadata, path: &Path) -> Result<u128, String> {
    metadata
        .modified()
        .map_err(|error| format!("cleanup_modified_time:{}:{error}", path.display()))?
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .map_err(|error| format!("cleanup_modified_before_epoch:{}:{error}", path.display()))
}

fn real_directory_size(path: &Path) -> Result<u64, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| format!("cleanup_metadata:{e}"))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("cleanup_refused_symlink:{}", path.display()));
    }
    if !metadata.file_type().is_dir() {
        return Err(format!("cleanup_refused_non_directory:{}", path.display()));
    }
    let mut total = 0u64;
    for entry in fs::read_dir(path).map_err(|e| format!("cleanup_read_dir:{e}"))? {
        let entry = entry.map_err(|e| format!("cleanup_entry:{e}"))?;
        let entry_path = entry.path();
        let metadata =
            fs::symlink_metadata(&entry_path).map_err(|e| format!("cleanup_entry_metadata:{e}"))?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            return Err(format!("cleanup_refused_symlink:{}", entry_path.display()));
        }
        if file_type.is_dir() {
            total = total.saturating_add(real_directory_size(&entry_path)?);
        } else if file_type.is_file() {
            total = total.saturating_add(metadata.len());
        } else {
            return Err(format!(
                "cleanup_refused_special_file:{}",
                entry_path.display()
            ));
        }
    }
    Ok(total)
}

fn add_cleanup_tree_digest(root: &Path, current: &Path, digest: &mut Sha256) -> Result<(), String> {
    let current_metadata = fs::symlink_metadata(current)
        .map_err(|error| format!("cleanup_digest_metadata:{error}"))?;
    if current_metadata.file_type().is_symlink() {
        return Err(format!("cleanup_refused_symlink:{}", current.display()));
    }
    if !current_metadata.file_type().is_dir() {
        return Err(format!(
            "cleanup_refused_non_directory:{}",
            current.display()
        ));
    }
    let current_relative = current
        .strip_prefix(root)
        .map_err(|error| format!("cleanup_digest_relative:{error}"))?
        .to_string_lossy()
        .replace('\\', "/");
    digest.update(b"directory\0");
    digest.update(current_relative.as_bytes());
    digest.update([0]);
    digest.update(cleanup_modified_unix_nanos(&current_metadata, current)?.to_le_bytes());

    let mut entries = fs::read_dir(current)
        .map_err(|error| format!("cleanup_digest_read:{error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("cleanup_digest_entry:{error}"))?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)
            .map_err(|error| format!("cleanup_digest_metadata:{error}"))?;
        let file_type = metadata.file_type();
        if file_type.is_symlink() {
            return Err(format!("cleanup_refused_symlink:{}", path.display()));
        }
        if file_type.is_dir() {
            add_cleanup_tree_digest(root, &path, digest)?;
        } else if file_type.is_file() {
            digest.update(b"file\0");
            let relative = path
                .strip_prefix(root)
                .map_err(|error| format!("cleanup_digest_relative:{error}"))?
                .to_string_lossy()
                .replace('\\', "/");
            digest.update(relative.as_bytes());
            digest.update([0]);
            digest.update(metadata.len().to_le_bytes());
            digest.update(cleanup_modified_unix_nanos(&metadata, &path)?.to_le_bytes());
            let (_, content_digest) = hash_file(&path)?;
            digest.update(content_digest.as_bytes());
        } else {
            return Err(format!("cleanup_refused_special_file:{}", path.display()));
        }
    }
    Ok(())
}

fn cleanup_entry_snapshot(root: &Path, candidate: &Path) -> Result<CleanupEntrySnapshot, String> {
    if candidate.parent() != Some(root)
        || !LEGACY_LOCAL_DATA_DIRS
            .iter()
            .any(|name| candidate.file_name().and_then(|value| value.to_str()) == Some(*name))
    {
        return Err(format!("cleanup_revalidation_path:{}", candidate.display()));
    }

    let root_metadata = fs::symlink_metadata(root)
        .map_err(|error| format!("cleanup_root_metadata:{}:{error}", root.display()))?;
    if root_metadata.file_type().is_symlink() {
        return Err(format!("cleanup_refused_symlink:{}", root.display()));
    }
    if !root_metadata.file_type().is_dir() {
        return Err(format!("cleanup_refused_non_directory:{}", root.display()));
    }

    let metadata = fs::symlink_metadata(candidate)
        .map_err(|error| format!("cleanup_metadata:{}:{error}", candidate.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("cleanup_refused_symlink:{}", candidate.display()));
    }
    if !metadata.file_type().is_dir() {
        return Err(format!(
            "cleanup_refused_special_file:{}",
            candidate.display()
        ));
    }
    let modified_unix_nanos = cleanup_modified_unix_nanos(&metadata, candidate)?;
    let bytes = real_directory_size(candidate)?;
    let mut digest = Sha256::new();
    digest.update(b"biyan-cleanup-entry-v1\0");
    add_cleanup_tree_digest(candidate, candidate, &mut digest)?;
    let content_digest = format!("{:x}", digest.finalize());

    let final_metadata = fs::symlink_metadata(candidate).map_err(|error| {
        format!(
            "cleanup_revalidate_metadata:{}:{error}",
            candidate.display()
        )
    })?;
    if !final_metadata.file_type().is_dir()
        || cleanup_modified_unix_nanos(&final_metadata, candidate)? != modified_unix_nanos
    {
        return Err(format!(
            "cleanup_snapshot_changed_during_scan:{}",
            candidate.display()
        ));
    }

    Ok(CleanupEntrySnapshot {
        root: root.to_string_lossy().into_owned(),
        path: candidate.to_string_lossy().into_owned(),
        bytes,
        modified_unix_nanos,
        content_digest,
    })
}

#[cfg(feature = "mobile")]
async fn validate_cleanup_mobile_database(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|error| format!("cleanup_mobile_db_metadata:{}:{error}", path.display()))?;
    if metadata.file_type().is_symlink() {
        return Err(format!("cleanup_refused_symlink:{}", path.display()));
    }
    if !metadata.file_type().is_file() {
        return Err(format!("cleanup_refused_special_file:{}", path.display()));
    }

    let url = format!("sqlite:{}", path.display());
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(
            SqliteConnectOptions::from_str(&url)
                .map_err(|error| format!("cleanup_mobile_db_url:{}:{error}", path.display()))?
                .read_only(true),
        )
        .await
        .map_err(|error| format!("cleanup_mobile_db_open:{}:{error}", path.display()))?;

    let result = async {
        let integrity = sqlx::query_scalar::<_, String>("PRAGMA quick_check")
            .fetch_all(&pool)
            .await
            .map_err(|error| {
                format!(
                    "cleanup_mobile_db_quick_check:{}:{error}",
                    path.display()
                )
            })?;
        if integrity.len() != 1 || integrity[0] != "ok" {
            return Err(format!(
                "cleanup_mobile_db_integrity:{}:{}",
                path.display(),
                integrity.join(";")
            ));
        }

        let required_tables: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('threads', 'messages')",
        )
        .fetch_one(&pool)
        .await
        .map_err(|error| format!("cleanup_mobile_db_schema:{}:{error}", path.display()))?;
        let thread_columns: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('threads') WHERE name IN ('id', 'data')",
        )
        .fetch_one(&pool)
        .await
        .map_err(|error| format!("cleanup_mobile_db_schema:{}:{error}", path.display()))?;
        let message_columns: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name IN ('id', 'thread_id', 'data')",
        )
        .fetch_one(&pool)
        .await
        .map_err(|error| format!("cleanup_mobile_db_schema:{}:{error}", path.display()))?;
        if required_tables != 2 || thread_columns != 2 || message_columns != 3 {
            return Err(format!(
                "cleanup_mobile_db_schema:{}:tables={required_tables}:threads={thread_columns}:messages={message_columns}",
                path.display()
            ));
        }
        Ok(())
    }
    .await;
    pool.close().await;
    result
}

#[cfg(feature = "mobile")]
fn validate_cleanup_mobile_databases(
    base: &Path,
    mobile_app_data: Option<&Path>,
) -> Result<(), String> {
    let mut candidates = BTreeSet::from([
        base.join("biyan.db"),
        base.join("uk.jingxing.mita").join("biyan.db"),
        base.join("uk.jingxing.mita.ios").join("biyan.db"),
    ]);
    if let Some(mobile_app_data) = mobile_app_data {
        let canonical_mobile_database = mobile_app_data.join("biyan.db");
        match fs::symlink_metadata(&canonical_mobile_database) {
            Ok(_) => {
                candidates.insert(canonical_mobile_database);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(format!(
                    "cleanup_mobile_db_missing:{}",
                    canonical_mobile_database.display()
                ));
            }
            Err(error) => {
                return Err(format!(
                    "cleanup_mobile_db_metadata:{}:{error}",
                    canonical_mobile_database.display()
                ));
            }
        }
    }
    let mut existing_candidates = Vec::new();
    for path in candidates {
        match fs::symlink_metadata(&path) {
            Ok(_) => existing_candidates.push(path),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "cleanup_mobile_db_metadata:{}:{error}",
                    path.display()
                ));
            }
        }
    }
    let candidates = existing_candidates;
    if candidates.is_empty() {
        return Ok(());
    }

    // Cleanup is a synchronous command and may itself run inside Tokio. Use a
    // separate thread so SQLx can safely use Tauri's async runtime without a
    // nested-runtime panic.
    std::thread::spawn(move || {
        tauri::async_runtime::block_on(async move {
            for path in candidates {
                validate_cleanup_mobile_database(&path).await?;
            }
            Ok(())
        })
    })
    .join()
    .map_err(|_| "cleanup_mobile_db_validation_panicked".to_string())?
}

fn validate_cleanup_prerequisites(
    base: &Path,
    mobile_app_data: Option<&Path>,
) -> Result<PathBuf, String> {
    let canonical_config_dir = base.join("Biyan");
    let state = load_state(&canonical_config_dir.join(STATE_FILE))?;
    if state.data_schema < TARGET_DATA_SCHEMA
        || ![
            "layout_v1",
            "assistant_ids_v1",
            "mcp_names_v1",
            "cleanup_v3",
        ]
        .iter()
        .all(|step| {
            state
                .steps
                .get(*step)
                .is_some_and(|state| state.status == StepStatus::Completed)
        })
    {
        return Err("cleanup_requires_completed_biyan_migration".to_string());
    }
    let canonical_config = canonical_config_dir.join(CONFIGURATION_FILE_NAME);
    let configuration = parse_config(&canonical_config)
        .ok_or_else(|| "cleanup_missing_biyan_configuration".to_string())?;
    let canonical_data = configured_data_path(&canonical_config, &configuration);
    if !canonical_data.is_dir() {
        return Err("cleanup_missing_biyan_data".to_string());
    }
    validate_json_tree(&canonical_data)
        .map_err(|error| format!("cleanup_biyan_integrity:{error}"))?;
    #[cfg(feature = "mobile")]
    validate_cleanup_mobile_databases(base, mobile_app_data)?;
    #[cfg(not(feature = "mobile"))]
    let _ = mobile_app_data;
    Ok(canonical_data)
}

fn cleanup_scope_key(base: &Path) -> String {
    fs::canonicalize(base)
        .unwrap_or_else(|_| base.to_path_buf())
        .to_string_lossy()
        .into_owned()
}

fn pending_cleanup_confirmations() -> &'static StdMutex<BTreeMap<String, PendingCleanupConfirmation>>
{
    PENDING_CLEANUP_CONFIRMATIONS.get_or_init(|| StdMutex::new(BTreeMap::new()))
}

fn build_cleanup_snapshot(
    base: &Path,
    mobile_app_data: Option<&Path>,
) -> Result<CleanupSnapshot, String> {
    let canonical_data = validate_cleanup_prerequisites(base, mobile_app_data)?;
    let mut roots = BTreeSet::from([canonical_data.clone()]);
    roots.extend(retained_legacy_sources_in(base)?);
    for config in config_candidates(base) {
        if let Some(configuration) = parse_config(&config) {
            roots.insert(configured_data_path(&config, &configuration));
        }
    }
    for name in [
        "Mita",
        "Silence",
        "Jan",
        "uk.jingxing.mita",
        "uk.jingxing.silence",
        "jan.ai.app",
    ] {
        roots.insert(base.join(name).join("data"));
    }

    let canonical_manifest = supported_user_data_manifest(&canonical_data)?;
    let mut entries = BTreeMap::new();
    for root in roots {
        for name in LEGACY_LOCAL_DATA_DIRS {
            let candidate = root.join(name);
            let metadata = match fs::symlink_metadata(&candidate) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    return Err(format!("cleanup_metadata:{}:{error}", candidate.display()));
                }
            };
            if metadata.file_type().is_symlink() {
                return Err(format!("cleanup_refused_symlink:{}", candidate.display()));
            }
            if !metadata.file_type().is_dir() {
                return Err(format!(
                    "cleanup_refused_special_file:{}",
                    candidate.display()
                ));
            }
            let entry = cleanup_entry_snapshot(&root, &candidate)?;
            entries.entry(entry.path.clone()).or_insert(entry);
        }
    }

    let inspection_entries = entries
        .values()
        .map(|entry| LegacyLocalDataEntry {
            path: entry.path.clone(),
            bytes: entry.bytes,
        })
        .collect::<Vec<_>>();
    let total_bytes = inspection_entries
        .iter()
        .fold(0u64, |total, entry| total.saturating_add(entry.bytes));

    let canonical_data_path = canonical_data.to_string_lossy().into_owned();
    let mut digest = Sha256::new();
    digest.update(b"biyan-legacy-local-data-cleanup-v3\0");
    digest.update(canonical_data_path.as_bytes());
    digest.update([0]);
    for (path, (bytes, content_digest)) in &canonical_manifest {
        digest.update(path.as_bytes());
        digest.update([0]);
        digest.update(bytes.to_le_bytes());
        digest.update(content_digest.as_bytes());
        digest.update([0]);
    }
    for entry in entries.values() {
        digest.update(entry.root.as_bytes());
        digest.update([0]);
        digest.update(entry.path.as_bytes());
        digest.update([0]);
        digest.update(entry.bytes.to_le_bytes());
        digest.update(entry.modified_unix_nanos.to_le_bytes());
        digest.update(entry.content_digest.as_bytes());
        digest.update([0]);
    }
    let snapshot_digest = format!("{:x}", digest.finalize());

    Ok(CleanupSnapshot {
        inspection: LegacyLocalDataInspection {
            entries: inspection_entries,
            total_bytes,
            confirmation_token: String::new(),
        },
        canonical_data_path,
        canonical_manifest,
        snapshot_digest,
        entries,
    })
}

fn issue_cleanup_confirmation(
    base: &Path,
    snapshot: CleanupSnapshot,
) -> Result<LegacyLocalDataInspection, String> {
    let scope = cleanup_scope_key(base);
    let mut confirmations = pending_cleanup_confirmations()
        .lock()
        .map_err(|_| "cleanup_confirmation_store_poisoned".to_string())?;
    // A new inspection for the same installation always invalidates the previous nonce.
    confirmations.remove(&scope);

    let mut inspection = snapshot.inspection.clone();
    if inspection.entries.is_empty() {
        return Ok(inspection);
    }

    let issued_at = now_ms();
    let nonce = Uuid::new_v4().simple().to_string();

    let mut token_digest = Sha256::new();
    token_digest.update(b"biyan-cleanup-confirmation-token-v1\0");
    token_digest.update(nonce.as_bytes());
    token_digest.update(snapshot.snapshot_digest.as_bytes());
    let token = format!("cleanup-v1.{nonce}.{:x}", token_digest.finalize());
    inspection.confirmation_token = token.clone();
    confirmations.insert(
        scope,
        PendingCleanupConfirmation {
            token,
            snapshot_digest: snapshot.snapshot_digest.clone(),
            expires_at_unix_ms: issued_at.saturating_add(CLEANUP_CONFIRMATION_TTL_MS),
            snapshot,
        },
    );
    Ok(inspection)
}

#[cfg(any(test, not(feature = "mobile")))]
fn inspect_legacy_local_data_in(base: &Path) -> Result<LegacyLocalDataInspection, String> {
    inspect_legacy_local_data_in_with_mobile_data(base, None)
}

fn inspect_legacy_local_data_in_with_mobile_data(
    base: &Path,
    mobile_app_data: Option<&Path>,
) -> Result<LegacyLocalDataInspection, String> {
    issue_cleanup_confirmation(base, build_cleanup_snapshot(base, mobile_app_data)?)
}

fn consume_cleanup_confirmation(
    base: &Path,
    confirmation_token: &str,
) -> Result<CleanupSnapshot, String> {
    if confirmation_token.is_empty() {
        return Err("cleanup_confirmation_mismatch".to_string());
    }
    let scope = cleanup_scope_key(base);
    let mut confirmations = pending_cleanup_confirmations()
        .lock()
        .map_err(|_| "cleanup_confirmation_store_poisoned".to_string())?;
    let pending = confirmations
        .get(&scope)
        .cloned()
        .ok_or_else(|| "cleanup_confirmation_mismatch".to_string())?;
    if pending.token != confirmation_token {
        // An invalid token must not consume the valid in-process confirmation.
        return Err("cleanup_confirmation_mismatch".to_string());
    }
    if now_ms() > pending.expires_at_unix_ms {
        confirmations.remove(&scope);
        return Err("cleanup_confirmation_expired".to_string());
    }

    // Consume a valid token before any revalidation or deletion. Every failure after this point
    // requires a fresh inspection and nonce.
    confirmations.remove(&scope);
    if pending.snapshot_digest != pending.snapshot.snapshot_digest {
        return Err("cleanup_confirmation_corrupted".to_string());
    }
    Ok(pending.snapshot)
}

fn cleanup_snapshots_match(expected: &CleanupSnapshot, current: &CleanupSnapshot) -> bool {
    expected.snapshot_digest == current.snapshot_digest
        && expected.canonical_data_path == current.canonical_data_path
        && expected.canonical_manifest == current.canonical_manifest
        && expected.entries == current.entries
}

fn cleanup_confirmation_digest(confirmation_token: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(b"biyan-cleanup-journal-confirmation-v1\0");
    digest.update(confirmation_token.as_bytes());
    format!("{:x}", digest.finalize())
}

fn save_cleanup_journal(base: &Path, journal: &CleanupJournal) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(journal)
        .map_err(|error| format!("cleanup_journal_serialize:{error}"))?;
    atomic_write(&base.join("Biyan").join(CLEANUP_JOURNAL_FILE), &payload)
        .map_err(|error| format!("cleanup_journal_write:{error}"))
}

fn revalidate_canonical_user_data(expected: &CleanupSnapshot) -> Result<(), String> {
    let canonical_path = PathBuf::from(&expected.canonical_data_path);
    let current = supported_user_data_manifest(&canonical_path)?;
    if current != expected.canonical_manifest {
        return Err("cleanup_canonical_manifest_changed".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn inspect_legacy_local_data<R: Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<LegacyLocalDataInspection, String> {
    let base = app
        .path()
        .data_dir()
        .map_err(|e| format!("cleanup_resolve_data_dir:{e}"))?;
    #[cfg(feature = "mobile")]
    let mobile_app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cleanup_resolve_mobile_app_data_dir:{e}"))?;
    #[cfg(feature = "mobile")]
    return inspect_legacy_local_data_in_with_mobile_data(&base, Some(&mobile_app_data));
    #[cfg(not(feature = "mobile"))]
    inspect_legacy_local_data_in(&base)
}

#[tauri::command]
pub fn cleanup_legacy_local_data<R: Runtime>(
    app: tauri::AppHandle<R>,
    confirmation_token: String,
) -> Result<u64, String> {
    let base = app
        .path()
        .data_dir()
        .map_err(|e| format!("cleanup_resolve_data_dir:{e}"))?;
    #[cfg(feature = "mobile")]
    let mobile_app_data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("cleanup_resolve_mobile_app_data_dir:{e}"))?;
    #[cfg(feature = "mobile")]
    return cleanup_legacy_local_data_in_with_mobile_data(
        &base,
        Some(&mobile_app_data),
        &confirmation_token,
    );
    #[cfg(not(feature = "mobile"))]
    cleanup_legacy_local_data_in(&base, &confirmation_token)
}

#[cfg(any(test, not(feature = "mobile")))]
fn cleanup_legacy_local_data_in(base: &Path, confirmation_token: &str) -> Result<u64, String> {
    cleanup_legacy_local_data_in_with_mobile_data(base, None, confirmation_token)
}

fn cleanup_legacy_local_data_in_with_mobile_data(
    base: &Path,
    mobile_app_data: Option<&Path>,
    confirmation_token: &str,
) -> Result<u64, String> {
    let _migration_lock = acquire_lock(&base.join("Biyan"))?;
    let expected = consume_cleanup_confirmation(base, confirmation_token)?;
    let current = build_cleanup_snapshot(base, mobile_app_data)?;
    if !cleanup_snapshots_match(&expected, &current) {
        return Err("cleanup_snapshot_changed".to_string());
    }

    let started_at = now_ms();
    let mut journal = CleanupJournal {
        format_version: 1,
        status: CleanupJournalStatus::Pending,
        snapshot_digest: expected.snapshot_digest.clone(),
        confirmation_digest: cleanup_confirmation_digest(confirmation_token),
        started_at_unix_ms: started_at,
        updated_at_unix_ms: started_at,
        total_bytes: expected.inspection.total_bytes,
        entries: expected
            .entries
            .values()
            .map(|entry| CleanupJournalEntry {
                root: entry.root.clone(),
                path: entry.path.clone(),
                bytes: entry.bytes,
                modified_unix_nanos: entry.modified_unix_nanos,
                content_digest: entry.content_digest.clone(),
                removed: false,
            })
            .collect(),
    };
    save_cleanup_journal(base, &journal)?;

    for expected_entry in expected.entries.values() {
        revalidate_canonical_user_data(&expected)?;
        let root = PathBuf::from(&expected_entry.root);
        let path = PathBuf::from(&expected_entry.path);
        let current_entry = cleanup_entry_snapshot(&root, &path)?;
        if &current_entry != expected_entry {
            return Err(format!("cleanup_entry_changed:{}", path.display()));
        }
        fs::remove_dir_all(&path).map_err(|e| format!("cleanup_remove_directory:{e}"))?;
        match fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!("cleanup_verify_removed:{}:{error}", path.display()));
            }
            Ok(_) => return Err(format!("cleanup_verify_removed:{}", path.display())),
        }
        if let Some(entry) = journal
            .entries
            .iter_mut()
            .find(|entry| entry.path == expected_entry.path)
        {
            entry.removed = true;
        }
        journal.updated_at_unix_ms = now_ms();
        save_cleanup_journal(base, &journal)?;
    }
    revalidate_canonical_user_data(&expected)?;
    journal.status = CleanupJournalStatus::Completed;
    journal.updated_at_unix_ms = now_ms();
    save_cleanup_journal(base, &journal)?;
    Ok(expected.inspection.total_bytes)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write_json(path: &Path, value: &Value) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
    }

    fn make_test_file_readonly(path: &Path) {
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(path, permissions).unwrap();
    }

    #[cfg(windows)]
    fn make_test_file_writable(path: &Path) {
        let mut permissions = fs::metadata(path).unwrap().permissions();
        permissions.set_readonly(false);
        fs::set_permissions(path, permissions).unwrap();
    }

    fn prepare_retired_local_data_cleanup() -> (TempDir, PathBuf, PathBuf) {
        let temp = TempDir::new().unwrap();
        let old_data = temp.path().join("Mita/data");
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": old_data}),
        );
        write_json(
            &old_data.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1"}),
        );
        fs::create_dir_all(old_data.join("llamacpp/models")).unwrap();
        fs::write(old_data.join("llamacpp/models/user-model.gguf"), b"asset").unwrap();

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        mark_component_migration(&report.canonical_config_dir, "extensions_manifest_v1", 1)
            .unwrap();
        mark_component_migration(
            &report.canonical_config_dir,
            "cleanup_v3",
            TARGET_DATA_SCHEMA,
        )
        .unwrap();
        let canonical_data = report.canonical_data_dir.clone();
        // The startup migration owns the same cross-process lock used by cleanup.
        // Explicit cleanup is only legal after startup reconciliation has finished.
        drop(report);
        (temp, old_data, canonical_data)
    }

    fn invalidate_cleanup_confirmation_for_test(base: &Path) {
        pending_cleanup_confirmations()
            .lock()
            .unwrap()
            .remove(&cleanup_scope_key(base));
    }

    fn expire_cleanup_confirmation_for_test(base: &Path) {
        let mut confirmations = pending_cleanup_confirmations().lock().unwrap();
        confirmations
            .get_mut(&cleanup_scope_key(base))
            .expect("cleanup confirmation should exist")
            .expires_at_unix_ms = 0;
    }

    #[cfg(feature = "mobile")]
    async fn create_mobile_test_database(path: &Path, thread_id: Option<&str>) {
        let url = format!("sqlite:{}", path.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str(&url)
                    .unwrap()
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE threads (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE messages (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        if let Some(thread_id) = thread_id {
            sqlx::query("INSERT INTO threads (id, data) VALUES (?1, ?2)")
                .bind(thread_id)
                .bind(format!(r#"{{"id":"{thread_id}"}}"#))
                .execute(&pool)
                .await
                .unwrap();
        }
        pool.close().await;
    }

    #[cfg(feature = "mobile")]
    async fn create_cleanup_mobile_test_database(path: &Path, include_messages: bool) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let url = format!("sqlite:{}", path.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str(&url)
                    .unwrap()
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query(
            "CREATE TABLE threads (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER, updated_at INTEGER)",
        )
        .execute(&pool)
        .await
        .unwrap();
        if include_messages {
            sqlx::query(
                "CREATE TABLE messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER)",
            )
            .execute(&pool)
            .await
            .unwrap();
        }
        pool.close().await;
    }

    fn current_0633_stock_mita_assistant(id: &str) -> Value {
        json!({
            "avatar": "👋",
            "id": id,
            "object": "assistant",
            "created_at": 1_752_500_000.25,
            "name": "Mita",
            "description": "Mita is a quiet desktop agent that can reason through complex tasks and use tools to complete the user's work.",
            "model": "*",
            "instructions": "You are Mita, a quiet and capable AI desktop agent built for the Mita app. The Chinese product name is 幂塔. Your purpose is to help the user calmly complete the work they assign.\n\nWhen the user asks who you are, say that you are Mita. Never say that you are Jan, Silence, Jan.ai, or an assistant trained, created, or maintained by Menlo Research, even if the selected model was originally released by Jan or Menlo Research.\n\nMita is an agent identity and proper noun. Never translate it when referring to your agent identity. In Chinese UI contexts, you may call the app 幂塔.\n\nYou must output your response in the exact language used in the latest user message. Do not provide translations or switch languages unless explicitly instructed to do so. If the input is mostly English, respond in English.\n\nWhen handling user queries:\n\n1. Think step by step about the query:\n   - Break complex questions into smaller, searchable parts\n   - Identify key search terms and parameters\n   - Consider what information is needed to provide a complete answer\n\n2. Use tools when they are needed:\n   - Analyze what information is missing.\n   - Choose the tool that directly closes that gap.\n   - Use precise parameters, then summarize the result clearly.\n\nYou have tools to search for and access real-time, up-to-date data. Use them when current or verifiable information matters.\n\nCurrent date: {{current_date}}",
            "tools": [{
                "type": "retrieval",
                "enabled": false,
                "useTimeWeightedRetriever": false,
                "settings": {
                    "top_k": 2,
                    "chunk_size": 1024,
                    "chunk_overlap": 64,
                    "retrieval_template": "Use the following pieces of context to answer the question at the end.\n----------------\nCONTEXT: {CONTEXT}\n----------------\nQUESTION: {QUESTION}\n----------------\nHelpful Answer:"
                }
            }],
            "file_ids": [],
            "parameters": {
                "temperature": 0.7,
                "top_k": 20,
                "top_p": 0.8,
                "repeat_penalty": 1.12
            }
        })
    }

    #[test]
    fn copied_readonly_user_data_is_synced_and_preserves_permissions() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("source");
        let staging = temp.path().join("staging");
        let settings = source.join("settings.json");
        let workspace_file = source.join("agent-workspaces/thread-1/user-source.txt");
        write_json(&settings, &json!({"theme":"system"}));
        fs::create_dir_all(workspace_file.parent().unwrap()).unwrap();
        fs::write(&workspace_file, b"user-owned workspace data").unwrap();
        make_test_file_readonly(&settings);
        make_test_file_readonly(&workspace_file);

        copy_supported_user_data(&source, &staging).unwrap();

        let copied_settings = staging.join("settings.json");
        let copied_workspace = staging.join("agent-workspaces/thread-1/user-source.txt");
        assert_eq!(
            fs::read(&copied_settings).unwrap(),
            fs::read(&settings).unwrap()
        );
        assert_eq!(
            fs::read(&copied_workspace).unwrap(),
            fs::read(&workspace_file).unwrap()
        );
        assert!(fs::metadata(&copied_settings)
            .unwrap()
            .permissions()
            .readonly());
        assert!(fs::metadata(&copied_workspace)
            .unwrap()
            .permissions()
            .readonly());

        #[cfg(windows)]
        for path in [settings, workspace_file, copied_settings, copied_workspace] {
            make_test_file_writable(&path);
        }
    }

    #[test]
    fn migrates_mita_layout_without_copying_local_models() {
        let temp = TempDir::new().unwrap();
        let old_data = temp.path().join("Mita/data");
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": old_data}),
        );
        write_json(
            &old_data.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1","assistants":[{"id":"mita"}]}),
        );
        write_json(
            &old_data.join("assistants/mita/assistant.json"),
            &current_0633_stock_mita_assistant("mita"),
        );
        fs::create_dir_all(old_data.join("llamacpp/models")).unwrap();
        fs::write(old_data.join("llamacpp/models/model.gguf"), b"model").unwrap();

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();

        assert_eq!(report.target_data_schema, TARGET_DATA_SCHEMA);
        assert_eq!(report.completed_data_schema, 0);
        assert!(report
            .canonical_data_dir
            .join("assistants/biyan/assistant.json")
            .exists());
        assert!(!report.canonical_data_dir.join("llamacpp").exists());
        assert!(old_data.join("llamacpp/models/model.gguf").exists());
        let thread =
            fs::read_to_string(report.canonical_data_dir.join("threads/t1/thread.json")).unwrap();
        assert!(thread.contains("\"biyan\""));
    }

    #[test]
    fn repeated_run_is_idempotent() {
        let temp = TempDir::new().unwrap();
        let old_data = temp.path().join("Jan/data");
        write_json(
            &temp.path().join("Jan/settings.json"),
            &serde_json::json!({"data_folder": old_data}),
        );
        write_json(
            &old_data.join("assistants/jan/assistant.json"),
            &current_0633_stock_mita_assistant("jan"),
        );
        let report = run_migrations_in(temp.path(), "0.6.634").unwrap();
        mark_component_migration(&report.canonical_config_dir, "extensions_manifest_v1", 1)
            .unwrap();
        mark_component_migration(
            &report.canonical_config_dir,
            "cleanup_v3",
            TARGET_DATA_SCHEMA,
        )
        .unwrap();
        let first = fs::read(temp.path().join("Biyan/migration-state.json")).unwrap();
        drop(report);
        run_migrations_in(temp.path(), "0.6.636").unwrap();
        let second: MigrationState = serde_json::from_slice(
            &fs::read(temp.path().join("Biyan/migration-state.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(second.data_schema, TARGET_DATA_SCHEMA);
        assert!(temp
            .path()
            .join("Biyan/data/assistants/biyan/assistant.json")
            .exists());
        assert!(!first.is_empty());
    }

    #[test]
    fn advances_forward_through_a_b_and_c_data_schemas() {
        let temp = TempDir::new().unwrap();
        let old_data = temp.path().join("Mita/data");
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": old_data}),
        );
        write_json(
            &old_data.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1","assistantId":"mita"}),
        );

        assert_eq!(
            run_migrations_to_schema(temp.path(), "0.6.634", 1)
                .unwrap()
                .target_data_schema,
            1
        );
        let a: MigrationState = serde_json::from_slice(
            &fs::read(temp.path().join("Biyan/migration-state.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(a.steps["layout_v1"].status, StepStatus::Completed);
        assert_eq!(a.data_schema, 0);
        assert_eq!(a.steps["remote_only_v2"].status, StepStatus::Pending);
        assert_eq!(a.steps["cleanup_v3"].status, StepStatus::Pending);
        mark_component_migration(&temp.path().join("Biyan"), "extensions_manifest_v1", 1).unwrap();
        let a_committed: MigrationState = serde_json::from_slice(
            &fs::read(temp.path().join("Biyan/migration-state.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(a_committed.data_schema, 1);

        assert_eq!(
            run_migrations_to_schema(temp.path(), "0.6.635", 2)
                .unwrap()
                .target_data_schema,
            2
        );
        let b: MigrationState = serde_json::from_slice(
            &fs::read(temp.path().join("Biyan/migration-state.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(b.steps["remote_only_v2"].status, StepStatus::Completed);
        assert_eq!(b.steps["cleanup_v3"].status, StepStatus::Pending);

        assert_eq!(
            run_migrations_to_schema(temp.path(), "0.6.636", 3)
                .unwrap()
                .target_data_schema,
            3
        );
        let c_pending: MigrationState = serde_json::from_slice(
            &fs::read(temp.path().join("Biyan/migration-state.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(c_pending.data_schema, 2);
        mark_component_migration(&temp.path().join("Biyan"), "cleanup_v3", 3).unwrap();
        assert!(run_migrations_to_schema(temp.path(), "0.6.635", 2)
            .unwrap_err()
            .starts_with("data_schema_downgrade_not_supported"));
    }

    #[test]
    fn cumulative_install_matrix_supports_skips_and_fresh_c() {
        for scenario in ["current-b", "current-c", "a-c", "b-c", "fresh-c"] {
            let temp = TempDir::new().unwrap();
            if scenario != "fresh-c" {
                let legacy = temp.path().join("Mita/data");
                write_json(
                    &legacy.join("threads/t1/thread.json"),
                    &json!({"id":"t1","assistantId":"mita"}),
                );
            }
            let config_dir = temp.path().join("Biyan");

            match scenario {
                "current-b" => {
                    drop(run_migrations_to_schema(temp.path(), "0.6.635", 2).unwrap());
                }
                "current-c" | "fresh-c" => {
                    drop(run_migrations_to_schema(temp.path(), "0.6.636", 3).unwrap());
                }
                "a-c" => {
                    drop(run_migrations_to_schema(temp.path(), "0.6.634", 1).unwrap());
                    mark_component_migration(&config_dir, "extensions_manifest_v1", 1).unwrap();
                    drop(run_migrations_to_schema(temp.path(), "0.6.636", 3).unwrap());
                }
                "b-c" => {
                    drop(run_migrations_to_schema(temp.path(), "0.6.635", 2).unwrap());
                    mark_component_migration(&config_dir, "extensions_manifest_v1", 1).unwrap();
                    drop(run_migrations_to_schema(temp.path(), "0.6.636", 3).unwrap());
                }
                _ => unreachable!(),
            }

            mark_component_migration(&config_dir, "extensions_manifest_v1", 1).unwrap();
            if scenario.ends_with('c') {
                mark_component_migration(&config_dir, "cleanup_v3", 3).unwrap();
            }
            let state = load_state(&config_dir.join(STATE_FILE)).unwrap();
            let expected_schema = if scenario == "current-b" { 2 } else { 3 };
            assert_eq!(state.data_schema, expected_schema, "{scenario}");
            for step in [
                "layout_v1",
                "mobile_db_v1",
                "extensions_manifest_v1",
                "cli_v1",
                "assistant_ids_v1",
                "assistant_db_refs_v1",
                "mcp_names_v1",
                "remote_only_v2",
            ] {
                assert!(step_completed(&state, step), "{scenario}: {step}");
            }
            if expected_schema == 3 {
                assert!(step_completed(&state, "cleanup_v3"), "{scenario}");
            }
            if scenario == "fresh-c" {
                assert!(temp.path().join("Biyan/data").is_dir());
            } else {
                let thread =
                    fs::read_to_string(temp.path().join("Biyan/data/threads/t1/thread.json"))
                        .unwrap();
                assert!(thread.contains("biyan"), "{scenario}");
                assert!(!thread.contains("mita"), "{scenario}");
            }
        }
    }

    #[test]
    fn custom_data_folder_is_not_duplicated() {
        let temp = TempDir::new().unwrap();
        let custom = temp.path().join("custom-user-data");
        fs::create_dir_all(&custom).unwrap();
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": custom}),
        );
        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert_eq!(report.canonical_data_dir, custom);
        assert!(!temp.path().join("Biyan/data").exists());
    }

    #[test]
    fn custom_data_folder_is_atomically_replaced_and_original_tree_is_retained() {
        let temp = TempDir::new().unwrap();
        let custom = temp.path().join("custom-user-data");
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": custom}),
        );
        write_json(
            &custom.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1","assistantId":"mita"}),
        );
        fs::create_dir_all(custom.join("models")).unwrap();
        fs::write(custom.join("models/user.gguf"), b"asset").unwrap();

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        let backup = temp.path().join(".custom-user-data.biyan-legacy-backup");
        assert_eq!(report.canonical_data_dir, custom);
        assert!(backup.join("models/user.gguf").is_file());
        assert!(backup.join("threads/t1/thread.json").is_file());
        assert!(!custom.join("models").exists());
        assert!(fs::read_to_string(custom.join("threads/t1/thread.json"))
            .unwrap()
            .contains("biyan"));
        assert!(report.retained_legacy_sources.contains(&backup));
    }

    #[test]
    fn empty_biyan_shell_does_not_mask_substantive_legacy_data() {
        let temp = TempDir::new().unwrap();
        let biyan = temp.path().join("Biyan/data");
        let legacy = temp.path().join("Mita/data");
        fs::create_dir_all(&biyan).unwrap();
        write_json(
            &temp.path().join("Biyan/settings.json"),
            &serde_json::json!({"data_folder": biyan}),
        );
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": legacy}),
        );
        write_json(
            &legacy.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1"}),
        );

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert_eq!(report.canonical_data_dir, biyan);
        assert!(biyan.join("threads/t1/thread.json").is_file());
        assert!(legacy.join("threads/t1/thread.json").is_file());
        assert!(temp.path().join("Biyan/.data.biyan-legacy-backup").is_dir());
    }

    #[test]
    fn empty_biyan_custom_path_does_not_replace_the_selected_legacy_custom_path() {
        let temp = TempDir::new().unwrap();
        let empty_biyan = temp.path().join("new-empty-custom");
        let legacy = temp.path().join("old-custom");
        fs::create_dir_all(&empty_biyan).unwrap();
        write_json(
            &temp.path().join("Biyan/settings.json"),
            &serde_json::json!({"data_folder": empty_biyan}),
        );
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": legacy}),
        );
        write_json(
            &legacy.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1"}),
        );

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert_eq!(report.canonical_data_dir, legacy);
        let biyan_configuration: AppConfiguration =
            serde_json::from_slice(&fs::read(temp.path().join("Biyan/settings.json")).unwrap())
                .unwrap();
        assert_eq!(PathBuf::from(biyan_configuration.data_folder), legacy);
        assert!(legacy.join("threads/t1/thread.json").is_file());
        assert!(temp
            .path()
            .join(".old-custom.biyan-legacy-backup/threads/t1/thread.json")
            .is_file());
    }

    #[test]
    fn synchronizes_existing_platform_and_data_dir_biyan_configurations() {
        let temp = TempDir::new().unwrap();
        let config_root = temp.path().join("platform-config");
        let empty_biyan = temp.path().join("empty-biyan-custom");
        let legacy = temp.path().join("legacy-custom");
        fs::create_dir_all(&empty_biyan).unwrap();
        write_json(
            &config_root.join("Biyan/settings.json"),
            &json!({"data_folder": empty_biyan}),
        );
        write_json(
            &temp.path().join("Mita/settings.json"),
            &json!({"data_folder": legacy}),
        );
        write_json(&legacy.join("threads/t1/thread.json"), &json!({"id":"t1"}));

        let first = run_migrations_to_schema_with_digest_and_config_root(
            temp.path(),
            "0.6.636",
            TARGET_DATA_SCHEMA,
            None,
            Some(&config_root),
            false,
        )
        .unwrap();
        assert_eq!(first.canonical_data_dir, legacy);
        drop(first);

        let second = run_migrations_to_schema_with_digest_and_config_root(
            temp.path(),
            "0.6.636",
            TARGET_DATA_SCHEMA,
            None,
            Some(&config_root),
            false,
        )
        .unwrap();
        assert_eq!(second.canonical_data_dir, legacy);
        for path in [
            temp.path().join("Biyan/settings.json"),
            config_root.join("Biyan/settings.json"),
        ] {
            let configuration: AppConfiguration =
                serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
            assert_eq!(PathBuf::from(configuration.data_folder), legacy);
        }
    }

    #[test]
    fn metadata_only_biyan_shell_does_not_mask_mita_threads() {
        let temp = TempDir::new().unwrap();
        let biyan = temp.path().join("Biyan/data");
        let mita = temp.path().join("Mita/data");
        fs::create_dir_all(biyan.join("threads")).unwrap();
        fs::write(biyan.join("threads/.DS_Store"), b"metadata").unwrap();
        write_json(
            &mita.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1"}),
        );

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert!(report
            .canonical_data_dir
            .join("threads/t1/thread.json")
            .is_file());
        assert_eq!(report.retained_legacy_sources.first(), Some(&mita));
    }

    #[test]
    fn empty_biyan_json_shell_does_not_mask_legacy_provider_or_mcp_settings() {
        let temp = TempDir::new().unwrap();
        let biyan = temp.path().join("Biyan/data");
        let mita = temp.path().join("Mita/data");
        write_json(&biyan.join("store.json"), &json!({"version":"0.6.633"}));
        write_json(
            &mita.join("mcp_config.json"),
            &json!({"mcpServers":{"My custom server":{"command":"custom-mcp"}}}),
        );

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert!(
            fs::read_to_string(report.canonical_data_dir.join("mcp_config.json"))
                .unwrap()
                .contains("custom-mcp")
        );
        assert_eq!(report.retained_legacy_sources.first(), Some(&mita));
    }

    #[test]
    fn resumes_an_interrupted_atomic_layout_switch_without_touching_the_source() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("Mita/data");
        let target = temp.path().join("Biyan/data");
        let (staging, backup) = data_migration_paths(&target).unwrap();
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": source}),
        );
        write_json(
            &temp.path().join("Biyan/settings.json"),
            &serde_json::json!({"data_folder": target}),
        );
        write_json(
            &source.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1"}),
        );
        fs::create_dir_all(&backup).unwrap();
        write_json(
            &staging.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1"}),
        );

        let state_path = temp.path().join("Biyan/migration-state.json");
        let mut state = MigrationState {
            selected_source: Some(source.to_string_lossy().into_owned()),
            ..MigrationState::default()
        };
        state.steps.insert(
            "layout_v1".to_string(),
            MigrationStepState {
                status: StepStatus::Running,
                source_schema: 0,
                target_schema: 1,
                updated_at_unix_ms: now_ms(),
                error_code: None,
                manifest_digest: None,
            },
        );
        save_state(&state_path, &state).unwrap();

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert!(target.join("threads/t1/thread.json").is_file());
        assert!(source.join("threads/t1/thread.json").is_file());
        assert!(backup.is_dir());
        assert_eq!(report.retained_legacy_sources.first(), Some(&source));
    }

    #[test]
    fn refuses_a_parseable_but_incomplete_crash_recovery_staging_tree() {
        let temp = TempDir::new().unwrap();
        let source = temp.path().join("Mita/data");
        let target = temp.path().join("Biyan/data");
        let (staging, backup) = data_migration_paths(&target).unwrap();
        for id in ["one", "two"] {
            write_json(
                &source.join(format!("threads/{id}/thread.json")),
                &json!({"id": id}),
            );
        }
        fs::create_dir_all(&backup).unwrap();
        write_json(
            &staging.join("threads/one/thread.json"),
            &json!({"id":"one"}),
        );

        let error = migrate_data_tree_atomically(&source, &target).unwrap_err();
        assert!(error.starts_with("migration_recovery_manifest_mismatch:"));
        assert!(!target.exists());
        assert!(staging.join("threads/one/thread.json").is_file());
        assert!(source.join("threads/two/thread.json").is_file());
    }

    #[test]
    fn brand_priority_beats_a_lower_priority_custom_configuration() {
        let temp = TempDir::new().unwrap();
        let mita = temp.path().join("Mita/data");
        let silence_custom = temp.path().join("silence-custom");
        write_json(
            &mita.join("threads/mita/thread.json"),
            &serde_json::json!({"id":"mita"}),
        );
        write_json(
            &temp.path().join("Silence/settings.json"),
            &serde_json::json!({"data_folder": silence_custom}),
        );
        write_json(
            &silence_custom.join("threads/silence/thread.json"),
            &serde_json::json!({"id":"silence"}),
        );

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert!(report
            .canonical_data_dir
            .join("threads/mita/thread.json")
            .is_file());
        assert!(!report
            .canonical_data_dir
            .join("threads/silence/thread.json")
            .exists());
    }

    #[test]
    fn corrupt_migration_state_fails_closed_without_reinitializing() {
        let temp = TempDir::new().unwrap();
        let state_path = temp.path().join("Biyan/migration-state.json");
        fs::create_dir_all(state_path.parent().unwrap()).unwrap();
        fs::write(&state_path, b"{broken-state").unwrap();

        let error = run_migrations_in(temp.path(), "0.6.636").unwrap_err();
        assert!(error.starts_with("invalid_migration_state:"));
        assert_eq!(fs::read(&state_path).unwrap(), b"{broken-state");
        assert!(!temp.path().join("Biyan/data").exists());
    }

    #[test]
    fn recovery_discovery_is_per_candidate_and_includes_platform_custom_paths() {
        let temp = TempDir::new().unwrap();
        let config_root = temp.path().join("platform-config");
        let custom = temp.path().join("custom-mita-data");
        write_json(
            &config_root.join("Mita/settings.json"),
            &json!({"data_folder": custom}),
        );
        write_json(&custom.join("threads/t1/thread.json"), &json!({"id":"t1"}));
        fs::create_dir_all(temp.path().join("Jan")).unwrap();
        fs::write(temp.path().join("Jan/settings.json"), b"{broken").unwrap();

        let sources = discover_recovery_data_sources(temp.path(), Some(&config_root));
        assert_eq!(sources.first(), Some(&custom));
    }

    #[test]
    fn assistant_reference_normalization_preserves_nested_user_payloads() {
        let mapping = BTreeMap::from([("jan".to_string(), "biyan".to_string())]);
        let mut value = json!({
            "assistant_id": "jan",
            "assistants": [{
                "id": "jan",
                "metadata": {"assistant_id": "jan"}
            }],
            "content": [{
                "type": "tool-result",
                "payload": {"assistant_id": "jan", "assistantId": "jan"}
            }],
            "metadata": {"defaultAssistantId": "jan"}
        });

        normalize_reference_value(&mut value, &mapping);

        assert_eq!(value["assistant_id"], "biyan");
        assert_eq!(value["assistants"][0]["id"], "biyan");
        assert_eq!(value["assistants"][0]["metadata"]["assistant_id"], "jan");
        assert_eq!(value["content"][0]["payload"]["assistant_id"], "jan");
        assert_eq!(value["content"][0]["payload"]["assistantId"], "jan");
        assert_eq!(value["metadata"]["defaultAssistantId"], "jan");
    }

    #[test]
    fn customized_legacy_assistant_keeps_a_deterministic_id() {
        let temp = TempDir::new().unwrap();
        let old_data = temp.path().join("Mita/data");
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": old_data}),
        );
        write_json(
            &old_data.join("assistants/jan/assistant.json"),
            &serde_json::json!({
                "id":"jan",
                "name":"My research copilot",
                "instructions":"Always preserve my custom workflow."
            }),
        );
        write_json(
            &old_data.join("threads/t1/thread.json"),
            &serde_json::json!({"assistant_id":"jan"}),
        );

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert!(report
            .canonical_data_dir
            .join("assistants/legacy-import-jan/assistant.json")
            .exists());
        let thread =
            fs::read_to_string(report.canonical_data_dir.join("threads/t1/thread.json")).unwrap();
        assert!(thread.contains("legacy-import-jan"));
    }

    #[test]
    fn branded_assistant_with_custom_avatar_is_never_treated_as_stock() {
        let temp = TempDir::new().unwrap();
        let data = temp.path().join("data");
        write_json(
            &data.join("assistants/jan/assistant.json"),
            &serde_json::json!({"id":"jan","name":"Jan","avatar":"🧪"}),
        );
        write_json(
            &data.join("threads/t1/thread.json"),
            &serde_json::json!({"assistantId":"jan"}),
        );

        let mapping = migrate_assistant_ids(&data).unwrap();
        assert_eq!(mapping["jan"], "legacy-import-jan");
        assert!(data
            .join("assistants/legacy-import-jan/assistant.json")
            .is_file());
    }

    #[test]
    fn real_0633_stock_assistant_uses_an_exact_fail_closed_fingerprint() {
        let stock = current_0633_stock_mita_assistant("mita");
        assert!(looks_like_unmodified_stock_assistant(&stock, "mita"));
        assert!(!looks_like_unmodified_stock_assistant(&stock, "jan"));

        for (key, replacement) in [
            ("model", json!("my-model")),
            ("tools", json!([])),
            ("file_ids", json!(["user-file"])),
            ("instructions", json!("My customized instructions")),
        ] {
            let mut customized = stock.clone();
            customized
                .as_object_mut()
                .unwrap()
                .insert(key.to_string(), replacement);
            assert!(!looks_like_unmodified_stock_assistant(&customized, "mita"));
        }
    }

    #[test]
    fn assistant_directory_without_manifest_is_preserved_as_user_data() {
        let temp = TempDir::new().unwrap();
        let data = temp.path().join("data");
        write_json(
            &data.join("assistants/biyan/assistant.json"),
            &serde_json::json!({"id":"biyan","name":"Biyan"}),
        );
        fs::create_dir_all(data.join("assistants/jan")).unwrap();
        fs::write(data.join("assistants/jan/user-note.txt"), b"keep").unwrap();
        write_json(
            &data.join("threads/t1/thread.json"),
            &serde_json::json!({"assistantId":"jan"}),
        );

        let mapping = migrate_assistant_ids(&data).unwrap();
        assert_eq!(mapping["jan"], "legacy-import-jan");
        assert_eq!(
            fs::read(data.join("assistants/legacy-import-jan/user-note.txt")).unwrap(),
            b"keep"
        );
    }

    #[test]
    fn arbitrary_workspace_json_is_preserved_without_schema_interpretation() {
        let temp = TempDir::new().unwrap();
        let old_data = temp.path().join("Mita/data");
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": old_data}),
        );
        fs::create_dir_all(old_data.join("agent-workspaces/t1")).unwrap();
        fs::write(old_data.join("agent-workspaces/t1/user.json"), b"not-json").unwrap();

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert_eq!(
            fs::read(
                report
                    .canonical_data_dir
                    .join("agent-workspaces/t1/user.json")
            )
            .unwrap(),
            b"not-json"
        );
    }

    #[test]
    fn resumes_after_custom_assistant_directory_was_already_renamed() {
        let temp = TempDir::new().unwrap();
        let data = temp.path().join("data");
        write_json(
            &data.join("assistants/legacy-import-jan/assistant.json"),
            &serde_json::json!({"id":"jan","name":"My custom assistant"}),
        );
        write_json(
            &data.join("threads/t1/thread.json"),
            &serde_json::json!({"assistantId":"jan"}),
        );

        migrate_assistant_ids(&data).unwrap();

        let assistant: Value = serde_json::from_slice(
            &fs::read(data.join("assistants/legacy-import-jan/assistant.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(assistant["id"], "legacy-import-jan");
        let thread = fs::read_to_string(data.join("threads/t1/thread.json")).unwrap();
        assert!(thread.contains("legacy-import-jan"));
    }

    #[test]
    fn custom_assistant_collision_uses_a_content_derived_id() {
        let temp = TempDir::new().unwrap();
        let data = temp.path().join("data");
        write_json(
            &data.join("assistants/legacy-import-jan/assistant.json"),
            &serde_json::json!({"id":"legacy-import-jan","name":"Existing profile"}),
        );
        write_json(
            &data.join("assistants/jan/assistant.json"),
            &serde_json::json!({"id":"jan","name":"My distinct custom assistant"}),
        );
        write_json(
            &data.join("threads/t1/thread.json"),
            &serde_json::json!({"assistantId":"jan"}),
        );

        migrate_assistant_ids(&data).unwrap();

        let entries = fs::read_dir(data.join("assistants"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<BTreeSet<_>>();
        let imported = entries
            .iter()
            .find(|name| name.starts_with("legacy-import-jan-"))
            .expect("content-derived imported assistant should exist");
        let thread = fs::read_to_string(data.join("threads/t1/thread.json")).unwrap();
        assert!(thread.contains(imported));
        assert!(data.join("assistants/legacy-import-jan").is_dir());
    }

    #[test]
    fn retired_local_data_cleanup_requires_fresh_explicit_confirmation() {
        let (temp, old_data, canonical_data) = prepare_retired_local_data_cleanup();
        let inspection = inspect_legacy_local_data_in(temp.path()).unwrap();
        assert_eq!(inspection.entries.len(), 1);
        assert_eq!(inspection.total_bytes, 5);
        assert_eq!(
            cleanup_legacy_local_data_in(temp.path(), "not-the-token").unwrap_err(),
            "cleanup_confirmation_mismatch"
        );
        assert!(old_data.join("llamacpp/models/user-model.gguf").exists());

        let removed =
            cleanup_legacy_local_data_in(temp.path(), inspection.confirmation_token.as_str())
                .unwrap();
        assert_eq!(removed, 5);
        assert!(!old_data.join("llamacpp").exists());
        assert!(canonical_data.join("threads/t1/thread.json").exists());
        assert_eq!(
            cleanup_legacy_local_data_in(temp.path(), inspection.confirmation_token.as_str())
                .unwrap_err(),
            "cleanup_confirmation_mismatch"
        );

        let journal_raw =
            fs::read_to_string(temp.path().join("Biyan").join(CLEANUP_JOURNAL_FILE)).unwrap();
        assert!(!journal_raw.contains(&inspection.confirmation_token));
        let journal: CleanupJournal = serde_json::from_str(&journal_raw).unwrap();
        assert_eq!(journal.status, CleanupJournalStatus::Completed);
        assert_eq!(journal.total_bytes, 5);
        assert!(journal.entries.iter().all(|entry| entry.removed));
    }

    #[test]
    fn retired_local_data_cleanup_consumes_confirmation_before_revalidation_failure() {
        let (temp, old_data, _) = prepare_retired_local_data_cleanup();
        let inspection = inspect_legacy_local_data_in(temp.path()).unwrap();
        let model = old_data.join("llamacpp/models/user-model.gguf");
        fs::write(&model, b"asset-mutated-after-inspection").unwrap();

        assert_eq!(
            cleanup_legacy_local_data_in(temp.path(), &inspection.confirmation_token).unwrap_err(),
            "cleanup_snapshot_changed"
        );
        assert!(model.exists());
        assert_eq!(
            cleanup_legacy_local_data_in(temp.path(), &inspection.confirmation_token).unwrap_err(),
            "cleanup_confirmation_mismatch"
        );

        let fresh = inspect_legacy_local_data_in(temp.path()).unwrap();
        assert_eq!(
            cleanup_legacy_local_data_in(temp.path(), &fresh.confirmation_token).unwrap(),
            b"asset-mutated-after-inspection".len() as u64
        );
        assert!(!old_data.join("llamacpp").exists());
    }

    #[test]
    fn retired_local_data_cleanup_confirmation_is_process_local_and_expires() {
        let (temp, old_data, _) = prepare_retired_local_data_cleanup();
        let before_restart = inspect_legacy_local_data_in(temp.path()).unwrap();
        invalidate_cleanup_confirmation_for_test(temp.path());
        assert_eq!(
            cleanup_legacy_local_data_in(temp.path(), &before_restart.confirmation_token)
                .unwrap_err(),
            "cleanup_confirmation_mismatch"
        );
        assert!(old_data.join("llamacpp").exists());

        let expired = inspect_legacy_local_data_in(temp.path()).unwrap();
        expire_cleanup_confirmation_for_test(temp.path());
        assert_eq!(
            cleanup_legacy_local_data_in(temp.path(), &expired.confirmation_token).unwrap_err(),
            "cleanup_confirmation_expired"
        );
        assert_eq!(
            cleanup_legacy_local_data_in(temp.path(), &expired.confirmation_token).unwrap_err(),
            "cleanup_confirmation_mismatch"
        );
        assert!(old_data.join("llamacpp").exists());
    }

    #[cfg(unix)]
    #[test]
    fn retired_local_data_cleanup_refuses_symlinks_and_special_files() {
        use std::os::unix::{fs::symlink, net::UnixListener};

        let (symlink_temp, symlink_old_data, _) = prepare_retired_local_data_cleanup();
        fs::remove_dir_all(symlink_old_data.join("llamacpp")).unwrap();
        let outside = symlink_temp.path().join("outside-models");
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("must-survive.gguf"), b"asset").unwrap();
        symlink(&outside, symlink_old_data.join("llamacpp")).unwrap();
        assert!(inspect_legacy_local_data_in(symlink_temp.path())
            .unwrap_err()
            .contains("cleanup_refused_symlink"));
        assert!(outside.join("must-survive.gguf").exists());

        let (special_temp, special_old_data, _) = prepare_retired_local_data_cleanup();
        let socket_path = special_old_data.join("llamacpp/models/runtime.sock");
        let _socket = UnixListener::bind(&socket_path).unwrap();
        assert!(inspect_legacy_local_data_in(special_temp.path())
            .unwrap_err()
            .contains("cleanup_refused_special_file"));
        assert!(special_old_data.join("llamacpp").exists());
    }

    #[cfg(feature = "mobile")]
    #[tokio::test]
    async fn retired_local_data_cleanup_validates_mobile_database_before_confirmation() {
        let (valid_temp, _, _) = prepare_retired_local_data_cleanup();
        let valid_mobile_data = valid_temp.path().join("actual-mobile-app-data");
        create_cleanup_mobile_test_database(&valid_mobile_data.join("biyan.db"), true).await;
        let inspection = inspect_legacy_local_data_in_with_mobile_data(
            valid_temp.path(),
            Some(&valid_mobile_data),
        )
        .unwrap();
        assert!(!inspection.confirmation_token.is_empty());
        invalidate_cleanup_confirmation_for_test(valid_temp.path());

        let (missing_temp, missing_old_data, _) = prepare_retired_local_data_cleanup();
        let missing_mobile_data = missing_temp.path().join("actual-mobile-app-data");
        let missing_error = inspect_legacy_local_data_in_with_mobile_data(
            missing_temp.path(),
            Some(&missing_mobile_data),
        )
        .unwrap_err();
        assert!(missing_error.starts_with("cleanup_mobile_db_missing:"));
        assert!(missing_old_data
            .join("llamacpp/models/user-model.gguf")
            .exists());

        let (schema_temp, schema_old_data, _) = prepare_retired_local_data_cleanup();
        let schema_mobile_data = schema_temp.path().join("actual-mobile-app-data");
        create_cleanup_mobile_test_database(&schema_mobile_data.join("biyan.db"), false).await;
        let schema_error = inspect_legacy_local_data_in_with_mobile_data(
            schema_temp.path(),
            Some(&schema_mobile_data),
        )
        .unwrap_err();
        assert!(schema_error.contains("cleanup_mobile_db_schema"));
        assert!(schema_old_data
            .join("llamacpp/models/user-model.gguf")
            .exists());

        let (corrupt_temp, corrupt_old_data, _) = prepare_retired_local_data_cleanup();
        let corrupt_mobile_data = corrupt_temp.path().join("actual-mobile-app-data");
        fs::create_dir_all(&corrupt_mobile_data).unwrap();
        fs::write(
            corrupt_mobile_data.join("biyan.db"),
            b"not-a-sqlite-database",
        )
        .unwrap();
        let corrupt_error = inspect_legacy_local_data_in_with_mobile_data(
            corrupt_temp.path(),
            Some(&corrupt_mobile_data),
        )
        .unwrap_err();
        assert!(corrupt_error.starts_with("cleanup_mobile_db_"));
        assert!(corrupt_old_data
            .join("llamacpp/models/user-model.gguf")
            .exists());
    }

    #[test]
    fn failed_integrity_check_does_not_mask_or_modify_the_legacy_source() {
        let temp = TempDir::new().unwrap();
        let old_data = temp.path().join("Mita/data");
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": old_data}),
        );
        fs::create_dir_all(old_data.join("threads/t1")).unwrap();
        let source = old_data.join("threads/t1/thread.json");
        fs::write(&source, b"{broken").unwrap();

        assert!(run_migrations_in(temp.path(), "0.6.634")
            .unwrap_err()
            .contains("invalid_json"));
        assert_eq!(fs::read(&source).unwrap(), b"{broken");
        assert!(!temp
            .path()
            .join("Biyan/data/threads/t1/thread.json")
            .exists());
        let failed: MigrationState = serde_json::from_slice(
            &fs::read(temp.path().join("Biyan/migration-state.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(failed.steps["layout_v1"].status, StepStatus::Failed);

        write_json(&source, &serde_json::json!({"id":"t1"}));
        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert!(report
            .canonical_data_dir
            .join("threads/t1/thread.json")
            .exists());
    }

    #[test]
    fn conflicting_legacy_sources_use_priority_without_merging() {
        let temp = TempDir::new().unwrap();
        let preferred = temp.path().join("Mita/data");
        let secondary = temp.path().join("Jan/data");
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": preferred}),
        );
        write_json(
            &temp.path().join("Jan/settings.json"),
            &serde_json::json!({"data_folder": secondary}),
        );
        write_json(
            &preferred.join("threads/preferred/thread.json"),
            &serde_json::json!({"id":"preferred"}),
        );
        write_json(
            &secondary.join("threads/secondary/thread.json"),
            &serde_json::json!({"id":"secondary"}),
        );

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert!(report
            .canonical_data_dir
            .join("threads/preferred/thread.json")
            .exists());
        assert!(!report
            .canonical_data_dir
            .join("threads/secondary/thread.json")
            .exists());
        assert!(report.retained_legacy_sources.contains(&secondary));
        let state: MigrationState = serde_json::from_slice(
            &fs::read(temp.path().join("Biyan/migration-state.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(state.retained_legacy_sources.len(), 2);
        assert_eq!(PathBuf::from(&state.retained_legacy_sources[0]), preferred);
        assert_eq!(first_legacy_data_source(temp.path()), Some(preferred));
    }

    #[test]
    fn preserves_computer_agent_workspaces_with_user_data() {
        let temp = TempDir::new().unwrap();
        let old_data = temp.path().join("Mita/data");
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder": old_data}),
        );
        fs::create_dir_all(old_data.join("agent-workspaces/thread-1")).unwrap();
        fs::write(
            old_data.join("agent-workspaces/thread-1/user-source.txt"),
            "keep me",
        )
        .unwrap();

        let report = run_migrations_in(temp.path(), "0.6.636").unwrap();
        assert_eq!(
            fs::read_to_string(
                report
                    .canonical_data_dir
                    .join("agent-workspaces/thread-1/user-source.txt")
            )
            .unwrap(),
            "keep me"
        );
    }

    #[test]
    fn corrupt_higher_priority_configuration_fails_without_creating_blank_data() {
        let temp = TempDir::new().unwrap();
        let old_data = temp.path().join("Mita/data");
        write_json(
            &old_data.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1"}),
        );
        fs::create_dir_all(temp.path().join("Mita")).unwrap();
        fs::write(temp.path().join("Mita/settings.json"), b"{broken").unwrap();

        let error = run_migrations_to_schema(temp.path(), "0.6.634", 1).unwrap_err();
        assert!(error.starts_with("invalid_data_configuration:"));
        assert!(!temp.path().join("Biyan/data").exists());
        assert!(old_data.join("threads/t1/thread.json").exists());
    }

    #[test]
    fn relative_legacy_data_folder_is_resolved_beside_its_configuration() {
        let temp = TempDir::new().unwrap();
        let old_data = temp.path().join("Mita/data");
        write_json(
            &temp.path().join("Mita/settings.json"),
            &serde_json::json!({"data_folder":"./data"}),
        );
        write_json(
            &old_data.join("threads/t1/thread.json"),
            &serde_json::json!({"id":"t1"}),
        );

        let report = run_migrations_to_schema(temp.path(), "0.6.634", 1).unwrap();
        assert!(report
            .canonical_data_dir
            .join("threads/t1/thread.json")
            .exists());
        assert!(old_data.join("threads/t1/thread.json").exists());
    }

    #[test]
    fn records_the_approved_manifest_digest_on_every_initialized_step() {
        let temp = TempDir::new().unwrap();
        let digest = "a".repeat(64);
        run_migrations_to_schema_with_digest(temp.path(), "0.6.634", 1, Some(digest.clone()))
            .unwrap();
        let state: MigrationState = serde_json::from_slice(
            &fs::read(temp.path().join("Biyan/migration-state.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(state.manifest_digest.as_deref(), Some(digest.as_str()));
        assert!(state
            .steps
            .values()
            .all(|step| step.manifest_digest.as_deref() == Some(digest.as_str())));
    }

    #[test]
    fn migration_lock_is_exclusive_until_the_full_report_is_dropped() {
        let temp = TempDir::new().unwrap();
        let first = run_migrations_to_schema(temp.path(), "0.6.634", 1).unwrap();
        assert!(run_migrations_to_schema(temp.path(), "0.6.634", 1)
            .unwrap_err()
            .starts_with("migration_locked:"));
        drop(first);
        assert!(run_migrations_to_schema(temp.path(), "0.6.634", 1).is_ok());
    }

    #[test]
    fn rejects_ambiguous_manifest_provenance_for_the_same_version() {
        let temp = TempDir::new().unwrap();
        let directory = temp.path().join("Biyan/approved-updates");
        write_json(
            &directory.join("first.json"),
            &serde_json::json!({
                "targetVersion":"0.6.635",
                "manifestDigest":"a".repeat(64)
            }),
        );
        write_json(
            &directory.join("second.json"),
            &serde_json::json!({
                "targetVersion":"0.6.635",
                "manifestDigest":"b".repeat(64)
            }),
        );
        assert_eq!(
            approved_manifest_digest(&temp.path().join("Biyan"), "0.6.635").unwrap_err(),
            "ambiguous_update_manifest_provenance"
        );
    }

    #[cfg(feature = "mobile")]
    #[tokio::test]
    async fn mobile_database_is_backed_up_validated_and_rewrites_assistant_references() {
        let temp = TempDir::new().unwrap();
        let legacy_path = temp.path().join("jan.db");
        let legacy_url = format!("sqlite:{}", legacy_path.display());
        let legacy_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str(&legacy_url)
                    .unwrap()
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE threads (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            .execute(&legacy_pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE messages (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            .execute(&legacy_pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO threads (id, data) VALUES (?1, ?2)")
            .bind("thread-1")
            .bind(r#"{"id":"thread-1","assistants":[{"id":"jan"}]}"#)
            .execute(&legacy_pool)
            .await
            .unwrap();
        legacy_pool.close().await;

        let canonical_path = temp.path().join("biyan.db");
        prepare_mobile_database(temp.path(), &canonical_path)
            .await
            .unwrap();
        assert!(legacy_path.exists());
        assert!(canonical_path.exists());

        let canonical_url = format!("sqlite:{}", canonical_path.display());
        let canonical_pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::from_str(&canonical_url).unwrap())
            .await
            .unwrap();
        let assistant_map = BTreeMap::from([(
            "jan".to_string(),
            "legacy-import-jan-0123456789ab".to_string(),
        )]);
        migrate_mobile_assistant_references(&canonical_pool, &assistant_map)
            .await
            .unwrap();
        let migrated: String = sqlx::query_scalar("SELECT data FROM threads WHERE id = ?1")
            .bind("thread-1")
            .fetch_one(&canonical_pool)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&migrated).unwrap()["assistants"][0]["id"],
            "legacy-import-jan-0123456789ab"
        );
        let integrity: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&canonical_pool)
            .await
            .unwrap();
        assert_eq!(integrity, "ok");
    }

    #[cfg(feature = "mobile")]
    #[tokio::test]
    async fn mobile_database_priority_ignores_only_corrupt_lower_sources() {
        let canonical_case = TempDir::new().unwrap();
        let canonical = canonical_case.path().join("biyan.db");
        create_mobile_test_database(&canonical, Some("biyan-thread")).await;
        fs::write(canonical_case.path().join("jan.db"), b"not-sqlite").unwrap();
        prepare_mobile_database(canonical_case.path(), &canonical)
            .await
            .unwrap();

        let legacy_case = TempDir::new().unwrap();
        let mita = legacy_case.path().join("mita.db");
        let migrated = legacy_case.path().join("biyan.db");
        create_mobile_test_database(&mita, Some("mita-thread")).await;
        fs::write(legacy_case.path().join("jan.db"), b"not-sqlite").unwrap();
        prepare_mobile_database(legacy_case.path(), &migrated)
            .await
            .unwrap();
        let migrated_url = format!("sqlite:{}", migrated.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::from_str(&migrated_url).unwrap())
            .await
            .unwrap();
        let id: String = sqlx::query_scalar("SELECT id FROM threads")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(id, "mita-thread");
    }

    #[cfg(feature = "mobile")]
    #[tokio::test]
    async fn mobile_database_skips_empty_higher_priority_shells() {
        let temp = TempDir::new().unwrap();
        let canonical = temp.path().join("biyan.db");
        create_mobile_test_database(&canonical, None).await;
        create_mobile_test_database(&temp.path().join("mita.db"), None).await;
        create_mobile_test_database(&temp.path().join("jan.db"), Some("jan-thread")).await;

        prepare_mobile_database(temp.path(), &canonical)
            .await
            .unwrap();
        assert!(temp.path().join("biyan.db.preexisting-empty").is_file());
        let canonical_url = format!("sqlite:{}", canonical.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(SqliteConnectOptions::from_str(&canonical_url).unwrap())
            .await
            .unwrap();
        let id: String = sqlx::query_scalar("SELECT id FROM threads")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(id, "jan-thread");
    }

    #[cfg(feature = "mobile")]
    #[tokio::test]
    async fn empty_partial_mobile_schema_is_safe_to_complete_transactionally() {
        let temp = TempDir::new().unwrap();
        let canonical = temp.path().join("biyan.db");
        let url = format!("sqlite:{}", canonical.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(
                SqliteConnectOptions::from_str(&url)
                    .unwrap()
                    .create_if_missing(true),
            )
            .await
            .unwrap();
        sqlx::query("CREATE TABLE threads (id TEXT PRIMARY KEY, data TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;

        prepare_mobile_database(temp.path(), &canonical)
            .await
            .unwrap();
        assert!(canonical.is_file());
    }
}
