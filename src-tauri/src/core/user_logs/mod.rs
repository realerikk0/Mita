use chrono::{Local, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use tauri::Manager;
use tauri::{AppHandle, Runtime};

const LOG_DIR_NAME: &str = "biyan";
const LOG_FILE_PREFIX: &str = "biyan-";
const LOG_FILE_SUFFIX: &str = ".log";
const DEFAULT_LOG_LIMIT: usize = 2_000;
const MAX_LOG_LIMIT: usize = 10_000;
const MAX_TEXT_LEN: usize = 2_000;
const MAX_CONTEXT_DEPTH: usize = 6;
const MAX_ARRAY_ITEMS: usize = 20;
const MAX_OBJECT_FIELDS: usize = 50;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadUserLogsOptions {
    pub limit: Option<usize>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserLogInput {
    pub level: Option<String>,
    pub target: Option<String>,
    pub event: Option<String>,
    pub message: Option<String>,
    pub context: Option<Value>,
    pub error: Option<Value>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserLogEntry {
    pub ts: String,
    pub level: String,
    pub target: String,
    pub event: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
    pub app_version: String,
    pub platform: String,
}

pub fn daily_log_file_name_for_date(date: chrono::NaiveDate) -> String {
    format!(
        "{LOG_FILE_PREFIX}{}{LOG_FILE_SUFFIX}",
        date.format("%Y-%m-%d")
    )
}

pub fn is_user_log_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with(LOG_FILE_PREFIX) && name.ends_with(LOG_FILE_SUFFIX))
        .unwrap_or(false)
}

pub fn user_logs_directory_for_platform(
    platform: &str,
    home_dir: Option<PathBuf>,
    local_data_dir: Option<PathBuf>,
) -> Result<PathBuf, String> {
    match platform {
        "macos" => home_dir
            .map(|home| home.join("Library").join("Logs").join(LOG_DIR_NAME))
            .ok_or_else(|| "Failed to resolve home directory for logs".to_string()),
        "windows" => local_data_dir
            .map(|dir| dir.join(LOG_DIR_NAME).join("logs"))
            .ok_or_else(|| "Failed to resolve LOCALAPPDATA for logs".to_string()),
        _ => local_data_dir
            .map(|dir| dir.join(LOG_DIR_NAME).join("logs"))
            .or_else(|| {
                home_dir.map(|home| {
                    home.join(".local")
                        .join("share")
                        .join(LOG_DIR_NAME)
                        .join("logs")
                })
            })
            .ok_or_else(|| "Failed to resolve local data directory for logs".to_string()),
    }
}

pub fn resolve_user_logs_directory<R: Runtime>(_app: &AppHandle<R>) -> Result<PathBuf, String> {
    #[cfg(target_os = "macos")]
    {
        return user_logs_directory_for_platform("macos", dirs::home_dir(), dirs::data_local_dir());
    }

    #[cfg(target_os = "windows")]
    {
        return user_logs_directory_for_platform(
            "windows",
            dirs::home_dir(),
            dirs::data_local_dir(),
        );
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        if let Ok(path) = _app.path().app_log_dir() {
            return Ok(path);
        }

        user_logs_directory_for_platform("linux", dirs::home_dir(), dirs::data_local_dir())
    }
}

pub fn append_log_entry(log_dir: &Path, entry: &UserLogEntry) -> Result<(), String> {
    fs::create_dir_all(log_dir).map_err(|err| err.to_string())?;
    let file_path = log_dir.join(daily_log_file_name_for_date(Local::now().date_naive()));
    let line = serde_json::to_string(entry).map_err(|err| err.to_string())?;
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file_path)
        .map_err(|err| err.to_string())?;
    writeln!(file, "{line}").map_err(|err| err.to_string())
}

pub fn entry_from_input(
    input: UserLogInput,
    app_version: String,
    platform: String,
) -> UserLogEntry {
    UserLogEntry {
        ts: Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true),
        level: normalize_level(input.level.as_deref()),
        target: sanitize_text(input.target.as_deref().unwrap_or("web-app")),
        event: sanitize_text(input.event.as_deref().unwrap_or("user.log")),
        message: sanitize_text(input.message.as_deref().unwrap_or_default()),
        context: input.context.map(|value| sanitize_value(value, 0)),
        error: input.error.map(|value| sanitize_value(value, 0)),
        app_version,
        platform,
    }
}

pub fn append_input_log<R: Runtime>(app: &AppHandle<R>, input: UserLogInput) -> Result<(), String> {
    let log_dir = resolve_user_logs_directory(app)?;
    let app_version = app
        .config()
        .version
        .clone()
        .unwrap_or_else(|| "unknown".to_string());
    let entry = entry_from_input(input, app_version, std::env::consts::OS.to_string());
    append_log_entry(&log_dir, &entry)
}

pub fn fern_dispatch_for_user_logs(
    log_dir: PathBuf,
    app_version: String,
    platform: String,
) -> tauri_plugin_log::fern::Dispatch {
    tauri_plugin_log::fern::Dispatch::new().chain(tauri_plugin_log::fern::Output::call(
        move |record| {
            let entry = entry_from_input(
                UserLogInput {
                    level: Some(record.level().as_str().to_ascii_lowercase()),
                    target: Some(record.target().to_string()),
                    event: Some("runtime.log".to_string()),
                    message: Some(record.args().to_string()),
                    context: None,
                    error: None,
                },
                app_version.clone(),
                platform.clone(),
            );
            if let Err(err) = append_log_entry(&log_dir, &entry) {
                eprintln!("Failed to write Biyan user log: {err}");
            }
        },
    ))
}

#[tauri::command]
pub fn write_user_log<R: Runtime>(app: AppHandle<R>, entry: UserLogInput) -> Result<(), String> {
    append_input_log(&app, entry)
}

#[tauri::command]
pub fn read_user_logs<R: Runtime>(
    app: AppHandle<R>,
    options: Option<ReadUserLogsOptions>,
) -> Result<String, String> {
    let limit = options
        .and_then(|options| options.limit)
        .unwrap_or(DEFAULT_LOG_LIMIT)
        .clamp(1, MAX_LOG_LIMIT);
    let log_dir = resolve_user_logs_directory(&app)?;
    let legacy_log = crate::core::app::commands::get_mita_data_folder_path(app)
        .join("logs")
        .join("app.log");
    read_recent_logs(&log_dir, Some(&legacy_log), limit)
}

#[tauri::command]
pub fn clear_user_logs<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    clear_user_log_files(&resolve_user_logs_directory(&app)?)
}

#[tauri::command]
pub fn get_user_logs_directory<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    resolve_user_logs_directory(&app).map(|path| path.to_string_lossy().into_owned())
}

pub fn read_recent_logs(
    log_dir: &Path,
    legacy_log: Option<&Path>,
    limit: usize,
) -> Result<String, String> {
    let mut lines = Vec::new();

    if let Some(legacy_log) = legacy_log {
        if legacy_log.is_file() {
            lines.extend(read_lines(legacy_log)?);
        }
    }

    if log_dir.is_dir() {
        let mut files = fs::read_dir(log_dir)
            .map_err(|err| err.to_string())?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_file() && is_user_log_file(path))
            .collect::<Vec<_>>();
        files.sort();

        for file in files {
            lines.extend(read_lines(&file)?);
        }
    }

    let start = lines.len().saturating_sub(limit);
    Ok(lines[start..].join("\n"))
}

pub fn clear_user_log_files(log_dir: &Path) -> Result<(), String> {
    if !log_dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(log_dir).map_err(|err| err.to_string())? {
        let path = entry.map_err(|err| err.to_string())?.path();
        if path.is_file() && is_user_log_file(&path) {
            fs::remove_file(&path).map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}

fn read_lines(path: &Path) -> Result<Vec<String>, String> {
    let content = fs::read_to_string(path).map_err(|err| err.to_string())?;
    Ok(content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect())
}

fn normalize_level(level: Option<&str>) -> String {
    match level.unwrap_or("info").to_ascii_lowercase().as_str() {
        "trace" | "debug" => "debug".to_string(),
        "warn" | "warning" => "warn".to_string(),
        "error" => "error".to_string(),
        _ => "info".to_string(),
    }
}

fn sanitize_text(text: &str) -> String {
    let compact = text.replace(['\r', '\n'], " ");
    if compact.chars().count() > MAX_TEXT_LEN {
        let mut truncated = compact.chars().take(MAX_TEXT_LEN).collect::<String>();
        truncated.push_str("...");
        truncated
    } else {
        compact
    }
}

fn sanitize_value(value: Value, depth: usize) -> Value {
    if depth > MAX_CONTEXT_DEPTH {
        return Value::String("<truncated-depth>".to_string());
    }

    match value {
        Value::String(text) => Value::String(sanitize_text(&text)),
        Value::Array(items) => Value::Array(
            items
                .into_iter()
                .take(MAX_ARRAY_ITEMS)
                .map(|item| sanitize_value(item, depth + 1))
                .collect(),
        ),
        Value::Object(map) => {
            let mut sanitized = Map::new();
            for (key, value) in map.into_iter().take(MAX_OBJECT_FIELDS) {
                if is_sensitive_key(&key) {
                    sanitized.insert(key, Value::String("<redacted>".to_string()));
                } else if is_path_key(&key) {
                    sanitized.insert(key, Value::String("<redacted-path>".to_string()));
                } else {
                    sanitized.insert(key, sanitize_value(value, depth + 1));
                }
            }
            Value::Object(sanitized)
        }
        other => other,
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key.contains("api_key")
        || key.contains("apikey")
        || key.contains("authorization")
        || key.contains("auth_token")
        || key.contains("access_token")
        || key.contains("refresh_token")
        || key.contains("bearer")
        || key.contains("cookie")
        || key.contains("password")
        || key.contains("secret")
        || key == "token"
        || key.ends_with("_token")
}

fn is_path_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key == "path"
        || key.contains("path")
        || key.ends_with("_path")
        || key.contains("folder")
        || key.contains("directory")
        || key.contains("file_path")
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;
    use tempfile::tempdir;

    #[test]
    fn daily_file_name_uses_biyan_prefix_and_date() {
        let date = NaiveDate::from_ymd_opt(2026, 6, 30).unwrap();
        assert_eq!(daily_log_file_name_for_date(date), "biyan-2026-06-30.log");
    }

    #[test]
    fn resolves_macos_and_windows_log_directories() {
        assert_eq!(
            user_logs_directory_for_platform(
                "macos",
                Some(PathBuf::from("/Users/owner")),
                Some(PathBuf::from("/ignored")),
            )
            .unwrap(),
            PathBuf::from("/Users/owner/Library/Logs/biyan")
        );
        assert_eq!(
            user_logs_directory_for_platform(
                "windows",
                Some(PathBuf::from("C:/Users/owner")),
                Some(PathBuf::from("C:/Users/owner/AppData/Local")),
            )
            .unwrap(),
            PathBuf::from("C:/Users/owner/AppData/Local/biyan/logs")
        );
    }

    #[test]
    fn entry_serializes_to_json_lines_shape() {
        let entry = entry_from_input(
            UserLogInput {
                level: Some("warning".to_string()),
                target: Some("settings".to_string()),
                event: Some("logs.clear".to_string()),
                message: Some("Cleared local logs".to_string()),
                context: Some(serde_json::json!({ "count": 2 })),
                error: None,
            },
            "0.6.632".to_string(),
            "macos".to_string(),
        );

        let json = serde_json::to_value(entry).unwrap();
        assert_eq!(json["level"], "warn");
        assert_eq!(json["target"], "settings");
        assert_eq!(json["event"], "logs.clear");
        assert_eq!(json["message"], "Cleared local logs");
        assert_eq!(json["appVersion"], "0.6.632");
        assert_eq!(json["platform"], "macos");
    }

    #[test]
    fn sanitizes_sensitive_and_path_context_fields() {
        let value = sanitize_value(
            serde_json::json!({
                "apiKey": "sk-secret",
                "Authorization": "Bearer secret",
                "selectedPath": "/Users/owner/private.txt",
                "message": "safe"
            }),
            0,
        );

        assert_eq!(value["apiKey"], "<redacted>");
        assert_eq!(value["Authorization"], "<redacted>");
        assert_eq!(value["selectedPath"], "<redacted-path>");
        assert_eq!(value["message"], "safe");
    }

    #[test]
    fn reads_recent_logs_from_legacy_and_daily_files() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("logs");
        fs::create_dir_all(&dir).unwrap();
        fs::write(tmp.path().join("app.log"), "legacy\n").unwrap();
        fs::write(dir.join("biyan-2026-06-29.log"), "old\n").unwrap();
        fs::write(dir.join("biyan-2026-06-30.log"), "new1\nnew2\n").unwrap();
        fs::write(dir.join("other.log"), "ignored\n").unwrap();

        let content = read_recent_logs(&dir, Some(&tmp.path().join("app.log")), 2).unwrap();
        assert_eq!(content, "new1\nnew2");
    }

    #[test]
    fn clear_only_removes_biyan_log_files() {
        let tmp = tempdir().unwrap();
        fs::write(tmp.path().join("biyan-2026-06-30.log"), "x").unwrap();
        fs::write(tmp.path().join("app.log"), "keep").unwrap();
        fs::write(tmp.path().join("biyan.txt"), "keep").unwrap();

        clear_user_log_files(tmp.path()).unwrap();

        assert!(!tmp.path().join("biyan-2026-06-30.log").exists());
        assert!(tmp.path().join("app.log").exists());
        assert!(tmp.path().join("biyan.txt").exists());
    }
}
