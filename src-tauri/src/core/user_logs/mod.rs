use chrono::{Duration, NaiveDate, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
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
const TAIL_READ_CHUNK_SIZE: u64 = 16 * 1024;
const LOG_RETENTION_DAYS: i64 = 30;

static LOG_WRITER: OnceLock<Mutex<LogFileWriter>> = OnceLock::new();
static LOG_LAST_PRUNED_DATE: OnceLock<Mutex<Option<NaiveDate>>> = OnceLock::new();

#[derive(Default)]
struct LogFileWriter {
    active_path: Option<PathBuf>,
    file: Option<File>,
}

impl LogFileWriter {
    fn write_line(&mut self, file_path: &Path, line: &str) -> Result<(), String> {
        if self.active_path.as_deref() != Some(file_path) {
            if let Some(parent) = file_path.parent() {
                fs::create_dir_all(parent).map_err(|err| err.to_string())?;
            }
            self.file = None;
            self.active_path = Some(file_path.to_path_buf());
            self.file = Some(
                OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(file_path)
                    .map_err(|err| err.to_string())?,
            );
        }

        let file = self
            .file
            .as_mut()
            .ok_or_else(|| "Failed to open user log file".to_string())?;
        file.write_all(line.as_bytes())
            .map_err(|err| err.to_string())
    }

    fn close_if_under(&mut self, dir: &Path) {
        if self
            .active_path
            .as_deref()
            .map(|path| path.starts_with(dir))
            .unwrap_or(false)
        {
            self.file = None;
            self.active_path = None;
        }
    }

    fn close_if_path(&mut self, path: &Path) {
        if self.active_path.as_deref() == Some(path) {
            self.file = None;
            self.active_path = None;
        }
    }
}

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
    let today = Utc::now().date_naive();
    if let Err(err) = prune_user_log_files_once_per_day(log_dir, today) {
        eprintln!("Failed to prune Biyan local logs: {err}");
    }

    let mut writer = acquire_log_writer()?;
    let file_path = log_dir.join(daily_log_file_name_for_date(today));
    let mut line = serde_json::to_string(entry).map_err(|err| err.to_string())?;
    line.push('\n');
    writer.write_line(&file_path, &line)
}

fn acquire_log_writer() -> Result<MutexGuard<'static, LogFileWriter>, String> {
    LOG_WRITER
        .get_or_init(|| Mutex::new(LogFileWriter::default()))
        .lock()
        .map_err(|_| "Failed to acquire user log writer".to_string())
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
                    message: Some(strip_legacy_log_prefix(&record.args().to_string()).to_string()),
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
    let log_dir = resolve_user_logs_directory(&app)?;
    let legacy_log = crate::core::app::commands::get_mita_data_folder_path(app)
        .join("logs")
        .join("app.log");
    clear_user_log_files(&log_dir)?;
    clear_legacy_log_file(&legacy_log)
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
    let mut remaining = limit;

    if log_dir.is_dir() {
        let mut files = fs::read_dir(log_dir)
            .map_err(|err| err.to_string())?
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.is_file() && is_user_log_file(path))
            .collect::<Vec<_>>();
        files.sort();

        for file in files.into_iter().rev() {
            if remaining == 0 {
                break;
            }
            let file_lines = read_tail_lines(&file, remaining)?;
            remaining = remaining.saturating_sub(file_lines.len());
            prepend_lines(&mut lines, file_lines);
        }
    }

    if let Some(legacy_log) = legacy_log {
        if remaining > 0 && legacy_log.is_file() {
            let legacy_lines = read_tail_lines(legacy_log, remaining)?;
            prepend_lines(&mut lines, legacy_lines);
        }
    }

    Ok(lines.join("\n"))
}

pub fn clear_user_log_files(log_dir: &Path) -> Result<(), String> {
    if let Ok(mut writer) = acquire_log_writer() {
        writer.close_if_under(log_dir);
    }

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

pub fn clear_legacy_log_file(legacy_log: &Path) -> Result<(), String> {
    if let Ok(mut writer) = acquire_log_writer() {
        writer.close_if_path(legacy_log);
    }
    if legacy_log.is_file() {
        fs::remove_file(legacy_log).map_err(|err| err.to_string())?;
    }
    Ok(())
}

pub fn prune_user_log_files(log_dir: &Path) -> Result<usize, String> {
    prune_user_log_files_for_date(log_dir, Utc::now().date_naive())
}

fn prune_user_log_files_once_per_day(log_dir: &Path, today: NaiveDate) -> Result<(), String> {
    let mut last_pruned = LOG_LAST_PRUNED_DATE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .map_err(|_| "Failed to acquire user log prune lock".to_string())?;

    if *last_pruned == Some(today) {
        return Ok(());
    }

    *last_pruned = Some(today);
    drop(last_pruned);

    prune_user_log_files_for_date(log_dir, today).map(|_| ())
}

fn prune_user_log_files_for_date(log_dir: &Path, today: NaiveDate) -> Result<usize, String> {
    if let Ok(mut writer) = acquire_log_writer() {
        writer.close_if_under(log_dir);
    }

    if !log_dir.exists() {
        return Ok(0);
    }

    let cutoff = today - Duration::days(LOG_RETENTION_DAYS - 1);
    let mut removed = 0;

    for entry in fs::read_dir(log_dir).map_err(|err| err.to_string())? {
        let path = entry.map_err(|err| err.to_string())?.path();
        if !path.is_file() {
            continue;
        }

        let Some(file_date) = user_log_file_date(&path) else {
            continue;
        };

        if file_date < cutoff {
            fs::remove_file(&path).map_err(|err| err.to_string())?;
            removed += 1;
        }
    }

    Ok(removed)
}

fn user_log_file_date(path: &Path) -> Option<NaiveDate> {
    let name = path.file_name()?.to_str()?;
    if !name.starts_with(LOG_FILE_PREFIX) || !name.ends_with(LOG_FILE_SUFFIX) {
        return None;
    }

    let date_start = LOG_FILE_PREFIX.len();
    let date_end = name.len().checked_sub(LOG_FILE_SUFFIX.len())?;
    let date = &name[date_start..date_end];
    if date.len() != "YYYY-MM-DD".len() {
        return None;
    }

    NaiveDate::parse_from_str(date, "%Y-%m-%d").ok()
}

fn read_tail_lines(path: &Path, limit: usize) -> Result<Vec<String>, String> {
    if limit == 0 {
        return Ok(Vec::new());
    }

    let mut file = File::open(path).map_err(|err| err.to_string())?;
    let mut cursor = file.metadata().map_err(|err| err.to_string())?.len();
    let mut buffer = Vec::new();
    let mut newline_count = 0;

    while cursor > 0 && newline_count <= limit {
        let chunk_size = cursor.min(TAIL_READ_CHUNK_SIZE);
        cursor -= chunk_size;

        let mut chunk = vec![0_u8; chunk_size as usize];
        file.seek(SeekFrom::Start(cursor))
            .map_err(|err| err.to_string())?;
        file.read_exact(&mut chunk).map_err(|err| err.to_string())?;
        newline_count += chunk.iter().filter(|byte| **byte == b'\n').count();

        let mut combined = chunk;
        combined.extend_from_slice(&buffer);
        buffer = combined;
    }

    let content = String::from_utf8_lossy(&buffer);
    let mut lines = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if cursor > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    let start = lines.len().saturating_sub(limit);
    Ok(lines[start..].to_vec())
}

fn prepend_lines(lines: &mut Vec<String>, new_lines: Vec<String>) {
    if new_lines.is_empty() {
        return;
    }

    let mut combined = new_lines;
    combined.append(lines);
    *lines = combined;
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
    let redacted = sanitize_free_text(&compact);
    if redacted.chars().count() > MAX_TEXT_LEN {
        let mut truncated = redacted.chars().take(MAX_TEXT_LEN).collect::<String>();
        truncated.push_str("...");
        truncated
    } else {
        redacted
    }
}

pub fn strip_legacy_log_prefix(line: &str) -> &str {
    let mut rest = line;
    for _ in 0..4 {
        if !rest.starts_with('[') {
            return line;
        }
        let Some(end) = rest.find(']') else {
            return line;
        };
        rest = &rest[end + 1..];
    }
    rest.trim_start()
}

fn sanitize_free_text(text: &str) -> String {
    let without_home = redact_home_paths(text);
    let without_urls = redact_urls_in_text(&without_home);
    redact_inline_secrets(&without_urls)
}

fn redact_home_paths(text: &str) -> String {
    let mut redacted = text.to_string();
    if let Some(home_dir) = dirs::home_dir() {
        if let Some(home) = home_dir.to_str() {
            if !home.is_empty() {
                redacted = redacted.replace(home, "<home>");
            }
        }
    }
    if let Ok(user_profile) = std::env::var("USERPROFILE") {
        if !user_profile.is_empty() {
            redacted = redacted.replace(&user_profile, "<home>");
        }
    }
    redacted
}

fn redact_urls_in_text(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    let mut rest = text;

    while let Some(start) = find_next_url_start(rest) {
        result.push_str(&rest[..start]);
        let after_start = &rest[start..];
        let end = after_start
            .find(|ch: char| ch.is_whitespace())
            .unwrap_or(after_start.len());
        result.push_str(&redact_url_token(&after_start[..end]));
        rest = &after_start[end..];
    }

    result.push_str(rest);
    result
}

fn find_next_url_start(text: &str) -> Option<usize> {
    match (text.find("http://"), text.find("https://")) {
        (Some(http), Some(https)) => Some(http.min(https)),
        (Some(http), None) => Some(http),
        (None, Some(https)) => Some(https),
        (None, None) => None,
    }
}

fn redact_url_token(token: &str) -> String {
    let mut core_end = token.len();
    while core_end > 0 {
        let Some(ch) = token[..core_end].chars().next_back() else {
            break;
        };
        if matches!(ch, '.' | ',' | ')' | ']' | '}' | '"' | '\'') {
            core_end -= ch.len_utf8();
        } else {
            break;
        }
    }

    let core = &token[..core_end];
    let suffix = &token[core_end..];
    let Ok(url) = url::Url::parse(core) else {
        return token.to_string();
    };

    let Some(host) = url.host_str() else {
        return token.to_string();
    };

    let mut safe = format!("{}://{}", url.scheme(), host);
    if let Some(port) = url.port() {
        safe.push(':');
        safe.push_str(&port.to_string());
    }
    safe.push_str(url.path());
    if url.query().is_some() {
        safe.push_str("?<redacted>");
    }
    if url.fragment().is_some() {
        safe.push_str("#<redacted>");
    }
    safe.push_str(suffix);
    safe
}

fn redact_inline_secrets(text: &str) -> String {
    let redacted = redact_after_prefixes(text, &["bearer ", "basic "], true);
    let redacted = redact_after_prefixes(
        &redacted,
        &[
            "api_key=",
            "apikey=",
            "access_token=",
            "refresh_token=",
            "auth_token=",
            "token=",
            "password=",
            "secret=",
        ],
        true,
    );
    redact_after_prefixes(
        &redacted,
        &["authorization:", "authorization=", "cookie:"],
        true,
    )
}

fn redact_after_prefixes(text: &str, prefixes: &[&str], stop_on_whitespace: bool) -> String {
    let lower = text.to_ascii_lowercase();
    let mut result = String::with_capacity(text.len());
    let mut cursor = 0;

    while cursor < text.len() {
        let Some((start, prefix)) = find_next_prefix(&lower, prefixes, cursor) else {
            result.push_str(&text[cursor..]);
            break;
        };

        result.push_str(&text[cursor..start]);
        result.push_str(&text[start..start + prefix.len()]);

        let secret_start = start + prefix.len();
        let secret_end = find_secret_end(text, secret_start, stop_on_whitespace);
        result.push_str("<redacted>");
        cursor = secret_end;
    }

    result
}

fn find_next_prefix<'a>(
    lower_text: &str,
    prefixes: &'a [&str],
    cursor: usize,
) -> Option<(usize, &'a str)> {
    prefixes
        .iter()
        .filter_map(|prefix| {
            lower_text[cursor..]
                .find(prefix)
                .map(|offset| (cursor + offset, *prefix))
        })
        .min_by_key(|(start, _)| *start)
}

fn find_secret_end(text: &str, start: usize, stop_on_whitespace: bool) -> usize {
    let value_start = text[start..]
        .char_indices()
        .find(|(_, ch)| !ch.is_whitespace())
        .map(|(offset, _)| start + offset)
        .unwrap_or(start);

    for (offset, ch) in text[value_start..].char_indices() {
        let is_delimiter = if stop_on_whitespace {
            ch.is_whitespace() || matches!(ch, '&' | ',' | ';' | '"' | '\'')
        } else {
            matches!(ch, ',' | ';' | '"' | '\'')
        };
        if is_delimiter {
            return value_start + offset;
        }
    }
    text.len()
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
        || key.contains("token")
}

fn is_path_key(key: &str) -> bool {
    let key = key.to_ascii_lowercase();
    key == "path"
        || key.contains("path")
        || key.ends_with("_path")
        || key.contains("folder")
        || key.contains("directory")
        || key.contains("file")
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
                "accessToken": "access-secret",
                "sessionToken": "session-secret",
                "Authorization": "Bearer secret",
                "selectedPath": "/Users/owner/private.txt",
                "filename": "/Users/owner/private.txt",
                "message": "safe"
            }),
            0,
        );

        assert_eq!(value["apiKey"], "<redacted>");
        assert_eq!(value["accessToken"], "<redacted>");
        assert_eq!(value["sessionToken"], "<redacted>");
        assert_eq!(value["Authorization"], "<redacted>");
        assert_eq!(value["selectedPath"], "<redacted-path>");
        assert_eq!(value["filename"], "<redacted-path>");
        assert_eq!(value["message"], "safe");
    }

    #[test]
    fn sanitizes_free_text_secrets_urls_and_home_paths() {
        let home_path = dirs::home_dir()
            .map(|path| path.join("secret.txt").to_string_lossy().into_owned())
            .unwrap_or_else(|| "/Users/owner/secret.txt".to_string());
        let text = format!(
            "failed Authorization: Bearer sk-secret api_key=abc123 url https://user:pass@example.com/api?token=abc#frag path {home_path}"
        );

        let sanitized = sanitize_text(&text);

        assert!(!sanitized.contains("sk-secret"));
        assert!(!sanitized.contains("abc123"));
        assert!(!sanitized.contains("user:pass"));
        assert!(!sanitized.contains("token=abc"));
        assert!(sanitized.contains("https://example.com/api?<redacted>#<redacted>"));
        if dirs::home_dir().is_some() {
            assert!(!sanitized.contains(&home_path));
            assert!(sanitized.contains("<home>"));
        }
    }

    #[test]
    fn strips_fern_formatted_runtime_prefix() {
        assert_eq!(
            strip_legacy_log_prefix(
                "[2026-06-30][12:00:00][runtime::target][ERROR] network failed"
            ),
            "network failed"
        );
        assert_eq!(strip_legacy_log_prefix("network failed"), "network failed");
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
    fn reads_tail_from_newest_files_without_losing_order() {
        let tmp = tempdir().unwrap();
        let dir = tmp.path().join("logs");
        fs::create_dir_all(&dir).unwrap();
        fs::write(tmp.path().join("app.log"), "legacy1\nlegacy2\n").unwrap();
        fs::write(dir.join("biyan-2026-06-29.log"), "old1\nold2\n").unwrap();
        fs::write(dir.join("biyan-2026-06-30.log"), "new1\nnew2\n").unwrap();

        let content = read_recent_logs(&dir, Some(&tmp.path().join("app.log")), 3).unwrap();

        assert_eq!(content, "old2\nnew1\nnew2");
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

    #[test]
    fn prunes_only_biyan_logs_older_than_retention_window() {
        let tmp = tempdir().unwrap();
        let today = NaiveDate::from_ymd_opt(2026, 6, 30).unwrap();
        let expired = tmp.path().join("biyan-2026-05-31.log");
        let boundary = tmp.path().join("biyan-2026-06-01.log");
        let current = tmp.path().join("biyan-2026-06-30.log");
        let invalid_date = tmp.path().join("biyan-not-a-date.log");
        let other = tmp.path().join("other.log");
        fs::write(&expired, "expired").unwrap();
        fs::write(&boundary, "boundary").unwrap();
        fs::write(&current, "current").unwrap();
        fs::write(&invalid_date, "invalid").unwrap();
        fs::write(&other, "other").unwrap();

        let removed = prune_user_log_files_for_date(tmp.path(), today).unwrap();

        assert_eq!(removed, 1);
        assert!(!expired.exists());
        assert!(boundary.exists());
        assert!(current.exists());
        assert!(invalid_date.exists());
        assert!(other.exists());
    }

    #[test]
    fn clear_legacy_log_removes_app_log() {
        let tmp = tempdir().unwrap();
        let legacy_log = tmp.path().join("app.log");
        fs::write(&legacy_log, "legacy").unwrap();

        clear_legacy_log_file(&legacy_log).unwrap();

        assert!(!legacy_log.exists());
    }

    #[test]
    fn concurrent_appends_keep_json_lines_intact() {
        let tmp = tempdir().unwrap();
        let mut handles = Vec::new();

        for thread_index in 0..16 {
            let log_dir = tmp.path().to_path_buf();
            handles.push(std::thread::spawn(move || {
                for item_index in 0..25 {
                    let entry = UserLogEntry {
                        ts: format!("2026-06-30T12:00:{item_index:02}.000Z"),
                        level: "info".to_string(),
                        target: "test".to_string(),
                        event: "concurrent.write".to_string(),
                        message: format!("{thread_index}-{item_index}"),
                        context: None,
                        error: None,
                        app_version: "test".to_string(),
                        platform: "test".to_string(),
                    };
                    append_log_entry(&log_dir, &entry).unwrap();
                }
            }));
        }

        for handle in handles {
            handle.join().unwrap();
        }

        let file_path = tmp
            .path()
            .join(daily_log_file_name_for_date(Utc::now().date_naive()));
        let content = fs::read_to_string(file_path).unwrap();
        let lines = content.lines().collect::<Vec<_>>();

        assert_eq!(lines.len(), 400);
        for line in lines {
            let parsed: UserLogEntry = serde_json::from_str(line).unwrap();
            assert_eq!(parsed.event, "concurrent.write");
        }
    }
}
