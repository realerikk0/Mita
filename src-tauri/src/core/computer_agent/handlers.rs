use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use rmcp::model::{CallToolResult, Content};
use serde_json::{json, Map, Value};

use crate::core::mcp::models::McpSettings;

use super::{
    permissions::{hidden_thread_id_arg, unique_txt_path, ComputerAgentScope},
    shell::{normalize_output_cap, normalize_timeout, run_shell, ShellRequest},
    tools::{
        canonical_computer_agent_tool_name, CREATE_DIRECTORY, CREATE_TEXT_FILE, LIST_DIRECTORY,
        MOVE_PATH, OPEN_PATH, READ_TEXT_FILE, RUN_SHELL, TRASH_PATH,
    },
};

const DEFAULT_READ_LIMIT_BYTES: u64 = 64 * 1024;
const MAX_READ_LIMIT_BYTES: u64 = 256 * 1024;

pub async fn handle_computer_agent_tool(
    biyan_data_folder: PathBuf,
    settings: McpSettings,
    tool_name: &str,
    arguments: Option<Map<String, Value>>,
) -> Result<CallToolResult, String> {
    if !settings.computer_agent_enabled {
        return Err("Computer Agent is disabled in settings".to_string());
    }

    let args = arguments.unwrap_or_default();
    let thread_id = string_arg(&args, hidden_thread_id_arg())
        .ok_or_else(|| "Computer Agent tool call is missing the current thread id".to_string())?;
    let scope = ComputerAgentScope::new(
        &biyan_data_folder,
        &thread_id,
        &settings.computer_agent_allowed_roots,
    )?;

    let canonical_tool_name = canonical_computer_agent_tool_name(tool_name)
        .ok_or_else(|| format!("Unknown Computer Agent tool '{tool_name}'"))?;
    if !settings.computer_agent_allows_writes()
        && !matches!(canonical_tool_name, LIST_DIRECTORY | READ_TEXT_FILE)
    {
        return Err(
            "Computer Agent sandbox is read-only; this action requires read-write access"
                .to_string(),
        );
    }
    if canonical_tool_name == RUN_SHELL && !settings.computer_agent_shell_enabled {
        return Err("Computer Agent shell is disabled in settings".to_string());
    }

    let text = match canonical_tool_name {
        CREATE_TEXT_FILE => create_text_file(&scope, &args)?,
        LIST_DIRECTORY => list_directory(&scope, &args)?,
        READ_TEXT_FILE => read_text_file(&scope, &args)?,
        CREATE_DIRECTORY => create_directory(&scope, &args)?,
        MOVE_PATH => move_path(&scope, &args)?,
        TRASH_PATH => trash_path(&scope, &args)?,
        OPEN_PATH => open_path(&scope, &args)?,
        RUN_SHELL => run_shell_tool(&scope, &args).await?,
        _ => unreachable!("canonical Computer Agent tool must be handled"),
    };

    Ok(CallToolResult::success(vec![Content::text(text)]))
}

fn create_text_file(
    scope: &ComputerAgentScope,
    args: &Map<String, Value>,
) -> Result<String, String> {
    let suggested_name = required_string_arg(args, "suggestedName")?;
    let content = required_raw_string_arg(args, "content")?;
    let directory = scope.resolve_directory_for_create(string_arg(args, "directory").as_deref())?;
    fs::create_dir_all(&directory).map_err(|e| {
        format!(
            "Failed to create directory '{}': {}",
            directory.display(),
            e
        )
    })?;

    let path = unique_txt_path(&directory, &suggested_name);
    scope.ensure_allowed(&path)?;
    fs::write(&path, content)
        .map_err(|e| format!("Failed to write '{}': {}", path.display(), e))?;

    json_text(json!({
        "created": true,
        "path": path,
    }))
}

fn list_directory(scope: &ComputerAgentScope, args: &Map<String, Value>) -> Result<String, String> {
    let directory = scope.resolve_existing_directory(string_arg(args, "path").as_deref())?;
    let mut entries = Vec::new();

    for entry in fs::read_dir(&directory)
        .map_err(|e| format!("Failed to list '{}': {}", directory.display(), e))?
        .take(200)
    {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {e}"))?;
        let path = entry.path();
        let metadata = entry
            .metadata()
            .map_err(|e| format!("Failed to read metadata for '{}': {}", path.display(), e))?;
        entries.push(json!({
            "name": entry.file_name().to_string_lossy(),
            "path": path,
            "isDirectory": metadata.is_dir(),
            "size": if metadata.is_file() { metadata.len() } else { 0 },
        }));
    }

    json_text(json!({
        "path": directory,
        "entries": entries,
    }))
}

fn read_text_file(scope: &ComputerAgentScope, args: &Map<String, Value>) -> Result<String, String> {
    let path = scope.resolve_existing(Some(&required_string_arg(args, "path")?))?;
    if !path.is_file() {
        return Err(format!("Path '{}' is not a file", path.display()));
    }

    let max_bytes = number_arg(args, "maxBytes")
        .unwrap_or(DEFAULT_READ_LIMIT_BYTES)
        .clamp(1, MAX_READ_LIMIT_BYTES) as usize;
    let bytes =
        fs::read(&path).map_err(|e| format!("Failed to read '{}': {}", path.display(), e))?;
    let truncated = bytes.len() > max_bytes;
    let text = String::from_utf8_lossy(&bytes[..bytes.len().min(max_bytes)]).to_string();

    json_text(json!({
        "path": path,
        "truncated": truncated,
        "content": text,
    }))
}

fn create_directory(
    scope: &ComputerAgentScope,
    args: &Map<String, Value>,
) -> Result<String, String> {
    let path = scope.resolve_new_path(&required_string_arg(args, "path")?)?;
    fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create directory '{}': {}", path.display(), e))?;

    json_text(json!({
        "created": true,
        "path": path,
    }))
}

fn move_path(scope: &ComputerAgentScope, args: &Map<String, Value>) -> Result<String, String> {
    let from = scope.resolve_existing(Some(&required_string_arg(args, "from")?))?;
    let to = scope.resolve_new_path(&required_string_arg(args, "to")?)?;
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination parent: {e}"))?;
    }
    fs::rename(&from, &to).map_err(|e| {
        format!(
            "Failed to move '{}' to '{}': {}",
            from.display(),
            to.display(),
            e
        )
    })?;

    json_text(json!({
        "moved": true,
        "from": from,
        "to": to,
    }))
}

fn trash_path(scope: &ComputerAgentScope, args: &Map<String, Value>) -> Result<String, String> {
    let path = scope.resolve_existing(Some(&required_string_arg(args, "path")?))?;
    move_to_trash(&path)?;

    json_text(json!({
        "trashed": true,
        "path": path,
    }))
}

fn open_path(scope: &ComputerAgentScope, args: &Map<String, Value>) -> Result<String, String> {
    let path = scope.resolve_existing(Some(&required_string_arg(args, "path")?))?;
    open_with_os(&path)?;

    json_text(json!({
        "opened": true,
        "path": path,
    }))
}

async fn run_shell_tool(
    scope: &ComputerAgentScope,
    args: &Map<String, Value>,
) -> Result<String, String> {
    let command = required_string_arg(args, "command")?;
    scope.ensure_workspace()?;
    let cwd = scope.resolve_existing_directory(Some(&required_string_arg(args, "cwd")?))?;
    let request = ShellRequest {
        command,
        cwd,
        timeout_seconds: normalize_timeout(number_arg(args, "timeoutSeconds")),
        max_output_bytes: normalize_output_cap(number_arg(args, "maxOutputBytes")),
    };

    run_shell(scope, request).await
}

fn required_string_arg(args: &Map<String, Value>, key: &str) -> Result<String, String> {
    string_arg(args, key)
        .filter(|v| !v.trim().is_empty())
        .ok_or_else(|| format!("Missing required argument '{key}'"))
}

fn required_raw_string_arg(args: &Map<String, Value>, key: &str) -> Result<String, String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(String::from)
        .ok_or_else(|| format!("Missing required argument '{key}'"))
}

fn string_arg(args: &Map<String, Value>, key: &str) -> Option<String> {
    args.get(key)
        .and_then(Value::as_str)
        .map(|value| value.trim().to_string())
}

fn number_arg(args: &Map<String, Value>, key: &str) -> Option<u64> {
    args.get(key).and_then(|value| {
        value
            .as_u64()
            .or_else(|| value.as_f64().map(|v| v.max(0.0) as u64))
    })
}

fn json_text(value: Value) -> Result<String, String> {
    serde_json::to_string_pretty(&value).map_err(|e| e.to_string())
}

fn open_with_os(path: &Path) -> Result<(), String> {
    let mut command = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("explorer");
        cmd.arg(path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000);
        }
        cmd
    } else if cfg!(target_os = "macos") {
        let mut cmd = Command::new("open");
        cmd.arg(path);
        cmd
    } else {
        let mut cmd = Command::new("xdg-open");
        cmd.arg(path);
        cmd
    };

    let status = command
        .status()
        .map_err(|e| format!("Failed to open '{}': {}", path.display(), e))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("Failed to open '{}'", path.display()))
    }
}

fn move_to_trash(path: &Path) -> Result<(), String> {
    if cfg!(target_os = "windows") {
        let is_dir = path.is_dir();
        let script = if is_dir {
            r#"
$p = $env:BIYAN_TRASH_PATH
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
"#
        } else {
            r#"
$p = $env:BIYAN_TRASH_PATH
Add-Type -AssemblyName Microsoft.VisualBasic
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin')
"#
        };
        let mut command = Command::new("powershell");
        command
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .env("BIYAN_TRASH_PATH", path);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let status = command
            .status()
            .map_err(|e| format!("Failed to move '{}' to recycle bin: {}", path.display(), e))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!(
            "Failed to move '{}' to recycle bin",
            path.display()
        ));
    }

    if cfg!(target_os = "macos") {
        let status = Command::new("osascript")
            .arg("-e")
            .arg(r#"tell application "Finder" to delete POSIX file (system attribute "BIYAN_TRASH_PATH")"#)
            .env("BIYAN_TRASH_PATH", path)
            .status()
            .map_err(|e| format!("Failed to move '{}' to Trash: {}", path.display(), e))?;
        if status.success() {
            return Ok(());
        }
        return Err(format!("Failed to move '{}' to Trash", path.display()));
    }

    for program in ["gio", "kioclient5", "kioclient"] {
        let mut command = Command::new(program);
        if program == "gio" {
            command.args(["trash"]).arg(path);
        } else {
            command.arg("move").arg(path).arg("trash:/");
        }
        if let Ok(status) = command.status() {
            if status.success() {
                return Ok(());
            }
        }
    }

    Err(format!(
        "No supported trash command was available for '{}'",
        path.display()
    ))
}
