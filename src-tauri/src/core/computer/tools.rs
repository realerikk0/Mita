use serde_json::json;

use crate::core::mcp::models::{McpSettings, ServerSummary, ToolWithServer};

pub const COMPUTER_SERVER_NAME: &str = "mita-computer";
pub const CREATE_TEXT_FILE: &str = "computer_create_text_file";
pub const LIST_DIRECTORY: &str = "computer_list_directory";
pub const READ_TEXT_FILE: &str = "computer_read_text_file";
pub const CREATE_DIRECTORY: &str = "computer_create_directory";
pub const MOVE_PATH: &str = "computer_move_path";
pub const TRASH_PATH: &str = "computer_trash_path";
pub const OPEN_PATH: &str = "computer_open_path";
pub const RUN_SHELL: &str = "computer_run_shell";

pub fn is_computer_tool(tool_name: &str) -> bool {
    matches!(
        tool_name,
        CREATE_TEXT_FILE
            | LIST_DIRECTORY
            | READ_TEXT_FILE
            | CREATE_DIRECTORY
            | MOVE_PATH
            | TRASH_PATH
            | OPEN_PATH
            | RUN_SHELL
    )
}

pub fn computer_summary(settings: &McpSettings) -> Option<ServerSummary> {
    if !settings.computer_use_enabled {
        return None;
    }

    Some(ServerSummary {
        name: COMPUTER_SERVER_NAME.to_string(),
        capabilities: vec![
            "computer".to_string(),
            "filesystem".to_string(),
            "files".to_string(),
            "shell".to_string(),
        ],
        description: "Create, read, list, move, trash, open files, and run sandboxed shell commands inside approved Mita computer-use roots.".to_string(),
    })
}

pub fn computer_tools(settings: &McpSettings, shell_available: bool) -> Vec<ToolWithServer> {
    if !settings.computer_use_enabled {
        return Vec::new();
    }

    let mut tools = vec![
        tool(
            CREATE_TEXT_FILE,
            "Create a UTF-8 .txt file. If directory is omitted, Mita creates it in this thread's private agent workspace. Use a short descriptive suggestedName without path separators.",
            json!({
                "type": "object",
                "properties": {
                    "suggestedName": {
                        "type": "string",
                        "description": "Short human-readable file name suggestion. Mita sanitizes it and appends .txt."
                    },
                    "content": {
                        "type": "string",
                        "description": "Text content to write."
                    },
                    "directory": {
                        "type": "string",
                        "description": "Optional destination directory. Must be inside this thread workspace or an allowed root."
                    }
                },
                "required": ["suggestedName", "content"],
                "additionalProperties": true
            }),
        ),
        tool(
            LIST_DIRECTORY,
            "List files and folders in a directory inside this thread workspace or an allowed root. If path is omitted, lists this thread's private agent workspace.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Optional directory path. Defaults to the thread workspace."
                    }
                },
                "additionalProperties": true
            }),
        ),
        tool(
            READ_TEXT_FILE,
            "Read a UTF-8 text file inside this thread workspace or an allowed root.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Path to the text file."
                    },
                    "maxBytes": {
                        "type": "number",
                        "description": "Optional maximum bytes to return. Defaults to 65536."
                    }
                },
                "required": ["path"],
                "additionalProperties": true
            }),
        ),
        tool(
            CREATE_DIRECTORY,
            "Create a directory inside this thread workspace or an allowed root.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path to create."
                    }
                },
                "required": ["path"],
                "additionalProperties": true
            }),
        ),
        tool(
            MOVE_PATH,
            "Move or rename a file or directory within this thread workspace or allowed roots.",
            json!({
                "type": "object",
                "properties": {
                    "from": {
                        "type": "string",
                        "description": "Existing source path."
                    },
                    "to": {
                        "type": "string",
                        "description": "Destination path."
                    }
                },
                "required": ["from", "to"],
                "additionalProperties": true
            }),
        ),
        tool(
            TRASH_PATH,
            "Move a file or directory to the system trash/recycle bin. Permanent deletion is not supported.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Existing path to move to trash."
                    }
                },
                "required": ["path"],
                "additionalProperties": true
            }),
        ),
        tool(
            OPEN_PATH,
            "Open a validated file or directory using the operating system default handler.",
            json!({
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Existing file or directory path to open."
                    }
                },
                "required": ["path"],
                "additionalProperties": true
            }),
        ),
    ];

    if settings.computer_shell_enabled && shell_available {
        tools.push(tool(
            RUN_SHELL,
            "Run one non-interactive shell command in a platform sandbox. Use only when structured file tools are insufficient. The cwd must be inside this thread workspace or an allowed root.",
            json!({
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "Single shell command to run non-interactively."
                    },
                    "cwd": {
                        "type": "string",
                        "description": "Working directory inside an allowed root."
                    },
                    "timeoutSeconds": {
                        "type": "number",
                        "description": "Optional timeout, clamped to 1-30 seconds."
                    },
                    "maxOutputBytes": {
                        "type": "number",
                        "description": "Optional output cap, clamped to 1024-65536 bytes."
                    }
                },
                "required": ["command", "cwd"],
                "additionalProperties": true
            }),
        ));
    }

    tools
}

fn tool(name: &str, description: &str, input_schema: serde_json::Value) -> ToolWithServer {
    ToolWithServer {
        name: name.to_string(),
        description: Some(description.to_string()),
        input_schema,
        server: COMPUTER_SERVER_NAME.to_string(),
    }
}
