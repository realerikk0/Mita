use std::fs;

#[cfg(any(windows, target_os = "macos"))]
use std::{
    env,
    io::Write,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    thread,
    time::Duration,
};

#[cfg(windows)]
use std::{
    ffi::OsStr,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Instant,
};

use serde_json::{json, Map};
use tempfile::tempdir;

use crate::core::{
    computer_agent::{
        commands::validate_computer_agent_allowed_root,
        handlers::handle_computer_agent_tool,
        permissions::{sanitize_file_stem, unique_txt_path, ComputerAgentScope},
        tools::{
            computer_agent_summary, computer_agent_tools, is_computer_agent_tool, CREATE_TEXT_FILE,
            CREATE_DIRECTORY, LIST_DIRECTORY, READ_TEXT_FILE, RUN_SHELL,
        },
        windows_runner::{
            refused_response, validate_runner_request, RunnerRequest, RunnerResponseStatus,
            RUNNER_PROTOCOL_VERSION,
        },
    },
    mcp::models::McpSettings,
};

#[cfg(windows)]
use crate::core::computer_agent::windows_runner::{
    cleanup_journal_path_for_test, runner_candidate_paths_from, sandbox_diagnostic_for_test,
    windows_runner_status, RUNNER_PATH_ENV,
};

#[cfg(any(windows, target_os = "macos"))]
use crate::core::computer_agent::windows_runner::{
    RunnerResponse, RUNNER_BINARY_NAME, RUNNER_EXECUTE_ENV,
};

fn settings_enabled() -> McpSettings {
    McpSettings {
        computer_agent_enabled: true,
        ..McpSettings::default()
    }
}

fn args(value: serde_json::Value) -> Map<String, serde_json::Value> {
    value.as_object().cloned().unwrap_or_default()
}

#[test]
fn default_scope_allows_thread_workspace() {
    let tmp = tempdir().unwrap();
    let scope = ComputerAgentScope::new(tmp.path(), "thread-1", &[]).unwrap();
    assert!(scope.workspace_root.ends_with("thread-1"));
    assert_eq!(scope.allowed_roots, vec![scope.workspace_root.clone()]);
}

#[test]
fn scope_rejects_parent_traversal_escape() {
    let tmp = tempdir().unwrap();
    let data = tmp.path().join("data");
    let outside = tmp.path().join("outside");
    fs::create_dir_all(data.join("agent-workspaces/t1")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("secret.txt"), "secret").unwrap();

    let scope = ComputerAgentScope::new(&data, "t1", &[]).unwrap();
    let result = scope.resolve_existing(Some("../../outside/secret.txt"));
    assert!(result.is_err());
}

#[test]
fn scope_rejects_symlink_escape_when_supported() {
    let tmp = tempdir().unwrap();
    let data = tmp.path().join("data");
    let outside = tmp.path().join("outside");
    let workspace = data.join("agent-workspaces/t1");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&outside).unwrap();
    fs::write(outside.join("secret.txt"), "secret").unwrap();

    #[cfg(unix)]
    std::os::unix::fs::symlink(&outside, workspace.join("link")).unwrap();
    #[cfg(windows)]
    {
        if std::os::windows::fs::symlink_dir(&outside, workspace.join("link")).is_err() {
            return;
        }
    }

    let scope = ComputerAgentScope::new(&data, "t1", &[]).unwrap();
    let result = scope.resolve_existing(Some("link/secret.txt"));
    assert!(result.is_err());
}

#[test]
fn file_name_sanitizer_removes_path_markers() {
    assert_eq!(
        sanitize_file_stem("../Meeting Notes?.txt"),
        "Meeting-Notes-txt"
    );
}

#[test]
fn unique_txt_path_adds_suffix() {
    let tmp = tempdir().unwrap();
    fs::write(tmp.path().join("notes.txt"), "one").unwrap();

    let path = unique_txt_path(tmp.path(), "notes");
    assert_eq!(path.file_name().unwrap().to_string_lossy(), "notes-2.txt");
}

#[test]
fn validate_allowed_root_accepts_directory_and_rejects_file() {
    let tmp = tempdir().unwrap();
    let root = tmp.path().join("allowed");
    let file = tmp.path().join("file.txt");
    fs::create_dir_all(&root).unwrap();
    fs::write(&file, "not a directory").unwrap();

    let validated = validate_computer_agent_allowed_root(root.to_string_lossy().to_string())
        .expect("directory should be accepted");
    assert_eq!(
        validated,
        root.canonicalize().unwrap().to_string_lossy().into_owned()
    );

    let rejected = validate_computer_agent_allowed_root(file.to_string_lossy().to_string());
    assert!(rejected.is_err());
}

#[test]
fn computer_agent_tools_hide_shell_when_unavailable() {
    let mut settings = settings_enabled();
    settings.computer_agent_shell_enabled = true;

    let tools = computer_agent_tools(&settings, false);
    assert!(!tools
        .iter()
        .any(|tool| tool.name == "computer_agent_run_shell"));
}

#[test]
fn computer_agent_tools_show_shell_when_enabled_and_available() {
    let mut settings = settings_enabled();
    settings.computer_agent_shell_enabled = true;

    let tools = computer_agent_tools(&settings, true);
    assert!(tools
        .iter()
        .any(|tool| tool.name == "computer_agent_run_shell"));
    assert!(!tools.iter().any(|tool| tool.name == "computer_run_shell"));
}

#[test]
fn computer_agent_tools_read_only_hides_write_and_shell_tools() {
    let mut settings = settings_enabled();
    settings.computer_agent_shell_enabled = true;
    settings.computer_agent_sandbox_access = "readOnly".to_string();

    let tools = computer_agent_tools(&settings, true);
    assert!(tools.iter().any(|tool| tool.name == LIST_DIRECTORY));
    assert!(tools.iter().any(|tool| tool.name == READ_TEXT_FILE));
    assert!(!tools.iter().any(|tool| tool.name == CREATE_TEXT_FILE));
    assert!(!tools.iter().any(|tool| tool.name == RUN_SHELL));
}

#[test]
fn create_directory_tool_explains_relative_workspace_paths() {
    let settings = settings_enabled();
    let tools = computer_agent_tools(&settings, false);
    let create_directory = tools
        .iter()
        .find(|tool| tool.name == CREATE_DIRECTORY)
        .expect("create directory tool should be exposed when writes are enabled");

    let description = create_directory.description.as_deref().unwrap_or_default();
    assert!(
        description.contains("relative"),
        "tool description should tell the model relative folder names are valid: {description}"
    );
    assert!(
        description.contains("thread"),
        "tool description should mention the thread workspace: {description}"
    );

    let path_description = create_directory.input_schema["properties"]["path"]["description"]
        .as_str()
        .unwrap_or_default();
    assert!(
        path_description.contains("Relative paths resolve inside the thread workspace"),
        "path schema should explain where a relative folder name like data is created: {path_description}"
    );
}

#[test]
fn legacy_computer_tool_names_route_as_aliases_but_are_not_exposed() {
    let settings = settings_enabled();
    let tools = computer_agent_tools(&settings, true);

    assert!(is_computer_agent_tool("computer_agent_create_text_file"));
    assert!(is_computer_agent_tool("computer_create_text_file"));
    assert!(!tools
        .iter()
        .any(|tool| tool.name == "computer_create_text_file"));
}

#[test]
fn computer_agent_summary_reports_shell_only_when_enabled_and_available() {
    let settings = settings_enabled();
    let summary = computer_agent_summary(&settings, true).unwrap();
    assert!(!summary.capabilities.iter().any(|value| value == "shell"));
    assert!(!summary.description.contains("shell commands"));

    let mut settings = settings_enabled();
    settings.computer_agent_shell_enabled = true;
    let unavailable = computer_agent_summary(&settings, false).unwrap();
    assert!(!unavailable
        .capabilities
        .iter()
        .any(|value| value == "shell"));

    let available = computer_agent_summary(&settings, true).unwrap();
    assert!(available.capabilities.iter().any(|value| value == "shell"));
    assert!(available.description.contains("shell commands"));

    let mut read_only = settings_enabled();
    read_only.computer_agent_shell_enabled = true;
    read_only.computer_agent_sandbox_access = "readOnly".to_string();
    let read_only_summary = computer_agent_summary(&read_only, true).unwrap();
    assert!(!read_only_summary
        .capabilities
        .iter()
        .any(|value| value == "shell"));
    assert!(read_only_summary.description.contains("Read and list"));
}

#[tokio::test]
async fn run_shell_requires_shell_setting_for_canonical_and_legacy_names() {
    let tmp = tempdir().unwrap();

    for (tool_name, thread_id) in [
        (RUN_SHELL, "thread-shell-disabled"),
        ("computer_run_shell", "thread-legacy-shell-disabled"),
    ] {
        let result = handle_computer_agent_tool(
            tmp.path().to_path_buf(),
            settings_enabled(),
            tool_name,
            Some(args(json!({
                "_mitaThreadId": thread_id,
                "command": "echo should-not-run",
                "cwd": ".",
                "timeoutSeconds": 1,
                "maxOutputBytes": 1024
            }))),
        )
        .await;

        match result {
            Ok(_) => panic!("{tool_name} should be rejected when shell is disabled"),
            Err(error) => assert!(
                error.contains("Computer Agent shell is disabled in settings"),
                "unexpected error for {tool_name}: {error}"
            ),
        }
        assert!(
            !tmp.path().join("agent-workspaces").join(thread_id).exists(),
            "{tool_name} should not create a workspace when shell is disabled"
        );
    }
}

#[tokio::test]
async fn read_only_sandbox_rejects_write_open_and_shell_tools() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("agent-workspaces").join("thread-read-only");
    fs::create_dir_all(&workspace).unwrap();
    fs::write(workspace.join("notes.txt"), "hello").unwrap();

    let mut settings = settings_enabled();
    settings.computer_agent_shell_enabled = true;
    settings.computer_agent_sandbox_access = "readOnly".to_string();

    let read = handle_computer_agent_tool(
        tmp.path().to_path_buf(),
        settings.clone(),
        READ_TEXT_FILE,
        Some(args(json!({
            "_mitaThreadId": "thread-read-only",
            "path": "notes.txt"
        }))),
    )
    .await;
    assert!(read.is_ok());

    for (tool_name, tool_args) in [
        (
            CREATE_TEXT_FILE,
            args(json!({
                "_mitaThreadId": "thread-read-only",
                "suggestedName": "blocked",
                "content": "nope"
            })),
        ),
        (
            "computer_open_path",
            args(json!({
                "_mitaThreadId": "thread-read-only",
                "path": "notes.txt"
            })),
        ),
        (
            RUN_SHELL,
            args(json!({
                "_mitaThreadId": "thread-read-only",
                "command": "echo nope",
                "cwd": "."
            })),
        ),
    ] {
        let result = handle_computer_agent_tool(
            tmp.path().to_path_buf(),
            settings.clone(),
            tool_name,
            Some(tool_args),
        )
        .await;
        match result {
            Ok(_) => panic!("{tool_name} should be rejected in read-only mode"),
            Err(error) => assert!(
                error.contains("Computer Agent sandbox is read-only"),
                "unexpected error for {tool_name}: {error}"
            ),
        }
    }
}

#[test]
fn windows_runner_protocol_rejects_cwd_outside_workspace() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let outside = tmp.path().join("outside");
    let request = RunnerRequest {
        protocol_version: RUNNER_PROTOCOL_VERSION,
        command: "echo hello".to_string(),
        cwd: outside,
        workspace_root: workspace,
        allowed_roots: Vec::new(),
        timeout_seconds: 30,
        max_output_bytes: 64 * 1024,
    };

    assert!(validate_runner_request(&request).is_err());
}

#[test]
fn windows_runner_protocol_rejects_sibling_prefix_escape() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let sibling = tmp.path().join("workspace-evil");
    let request = RunnerRequest {
        protocol_version: RUNNER_PROTOCOL_VERSION,
        command: "echo hello".to_string(),
        cwd: sibling,
        workspace_root: workspace,
        allowed_roots: Vec::new(),
        timeout_seconds: 30,
        max_output_bytes: 64 * 1024,
    };

    assert!(validate_runner_request(&request).is_err());
}

#[test]
fn windows_runner_protocol_accepts_cwd_inside_allowed_root() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let allowed = tmp.path().join("allowed");
    let cwd = allowed.join("project");
    let request = RunnerRequest {
        protocol_version: RUNNER_PROTOCOL_VERSION,
        command: "echo hello".to_string(),
        cwd,
        workspace_root: workspace,
        allowed_roots: vec![allowed],
        timeout_seconds: 30,
        max_output_bytes: 64 * 1024,
    };

    assert!(validate_runner_request(&request).is_ok());
}

#[test]
fn windows_runner_protocol_rejects_allowed_root_sibling_prefix_escape() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let allowed = tmp.path().join("allowed");
    let sibling = tmp.path().join("allowed-evil");
    let request = RunnerRequest {
        protocol_version: RUNNER_PROTOCOL_VERSION,
        command: "echo hello".to_string(),
        cwd: sibling,
        workspace_root: workspace,
        allowed_roots: vec![allowed],
        timeout_seconds: 30,
        max_output_bytes: 64 * 1024,
    };

    assert!(validate_runner_request(&request).is_err());
}

#[test]
fn windows_runner_protocol_validates_version_and_limits() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let request = RunnerRequest {
        protocol_version: RUNNER_PROTOCOL_VERSION + 1,
        command: "echo hello".to_string(),
        cwd: workspace.clone(),
        workspace_root: workspace,
        allowed_roots: Vec::new(),
        timeout_seconds: 30,
        max_output_bytes: 64 * 1024,
    };

    assert!(validate_runner_request(&request).is_err());
}

#[test]
fn windows_runner_refusal_uses_structured_response() {
    let response = refused_response("not ready");
    assert_eq!(response.status, RunnerResponseStatus::Refused);
    assert_eq!(response.message, "not ready");
    assert!(!response.timed_out);
}

#[cfg(windows)]
#[test]
fn windows_runner_candidates_include_packaged_resource_path() {
    let current_exe = Path::new(r"C:\Program Files\Mita\Mita.exe");
    let manifest_dir = Path::new(r"E:\codexprojects\Mita\src-tauri");
    let candidates = runner_candidate_paths_from(current_exe, Some(manifest_dir));

    assert!(candidates.contains(&PathBuf::from(
        r"C:\Program Files\Mita\resources\bin\mita-computer-agent-runner.exe"
    )));
    assert!(candidates.contains(&PathBuf::from(
        r"C:\Program Files\Mita\resources\computer-agent-runner\mita-computer-agent-runner.exe"
    )));
    assert!(candidates.contains(&PathBuf::from(
        r"E:\codexprojects\Mita\src-tauri\resources\computer-agent-runner\mita-computer-agent-runner.exe"
    )));
    assert!(candidates.contains(&PathBuf::from(
        r"E:\codexprojects\Mita\src-tauri\target\debug\mita-computer-agent-runner.exe"
    )));
}

#[cfg(windows)]
#[test]
fn windows_runner_diagnostic_is_local_and_stage_based() {
    let diagnostic = sandbox_diagnostic_for_test(
        "workspace-acl-grant",
        "icacls failed to grant workspace ACL: Access is denied.",
        "Confirm the workspace is on an NTFS local drive and the current user can change its ACL.",
    );

    assert!(diagnostic.contains("Windows Computer Agent sandbox diagnostic"));
    assert!(diagnostic.contains("Stage: workspace-acl-grant"));
    assert!(diagnostic.contains("Reason: icacls failed to grant workspace ACL"));
    assert!(diagnostic.contains("Next step: Confirm the workspace is on an NTFS local drive"));
    assert!(diagnostic.contains("Telemetry: none"));

    let app_container = sandbox_diagnostic_for_test(
        "app-container-profile",
        "CreateAppContainerProfile failed with HRESULT 0x80070005",
        "Confirm Windows AppContainer APIs are available for this user and retry.",
    );
    assert!(app_container.contains("Stage: app-container-profile"));
}

#[tokio::test]
async fn create_and_read_text_file_in_thread_workspace() {
    let tmp = tempdir().unwrap();
    let mut create_args = args(json!({
        "_mitaThreadId": "thread-1",
        "suggestedName": "Meeting Notes",
        "content": "  hello\n"
    }));

    let created = handle_computer_agent_tool(
        tmp.path().to_path_buf(),
        settings_enabled(),
        CREATE_TEXT_FILE,
        Some(create_args.clone()),
    )
    .await
    .unwrap();
    let created_text = created.content[0].as_text().unwrap().text.clone();
    let created_json: serde_json::Value = serde_json::from_str(&created_text).unwrap();
    let path = created_json["path"].as_str().unwrap().to_string();
    assert!(path.ends_with("Meeting-Notes.txt"));
    assert!(fs::metadata(&path).unwrap().is_file());
    assert_eq!(fs::read_to_string(&path).unwrap(), "  hello\n");

    create_args.insert("path".into(), json!(path));
    let read = handle_computer_agent_tool(
        tmp.path().to_path_buf(),
        settings_enabled(),
        READ_TEXT_FILE,
        Some(create_args),
    )
    .await
    .unwrap();
    let read_text = read.content[0].as_text().unwrap().text.clone();
    assert!(read_text.contains("\"content\": \"  hello\\n\""));
}

#[tokio::test]
async fn shell_relative_cwd_creates_thread_workspace_before_status_check() {
    let tmp = tempdir().unwrap();
    let mut settings = settings_enabled();
    settings.computer_agent_shell_enabled = true;

    let result = handle_computer_agent_tool(
        tmp.path().to_path_buf(),
        settings,
        RUN_SHELL,
        Some(args(json!({
            "_mitaThreadId": "thread-shell-default-cwd",
            "command": "echo shell-default-cwd",
            "cwd": ".",
            "timeoutSeconds": 1,
            "maxOutputBytes": 1024
        }))),
    )
    .await;

    assert!(tmp
        .path()
        .join("agent-workspaces/thread-shell-default-cwd")
        .is_dir());

    if let Err(error) = result {
        assert!(
            !error.contains("must exist and be accessible"),
            "shell should not fail before creating the default workspace: {error}"
        );
    }
}

#[cfg(windows)]
#[tokio::test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
async fn windows_shell_runs_through_runner_when_enabled() {
    let _guard = windows_runner_env_lock().lock().unwrap();
    let runner = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("debug")
        .join("mita-computer-agent-runner.exe");
    assert!(
        runner.is_file(),
        "runner binary not found at {}; run cargo build --bin mita-computer-agent-runner first",
        runner.display()
    );

    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("agent-workspaces").join("thread-shell");
    fs::create_dir_all(&workspace).unwrap();

    let previous_path = env::var_os(RUNNER_PATH_ENV);
    env::set_var(RUNNER_PATH_ENV, &runner);

    let result = handle_computer_agent_tool(
        tmp.path().to_path_buf(),
        McpSettings {
            computer_agent_enabled: true,
            computer_agent_shell_enabled: true,
            ..McpSettings::default()
        },
        RUN_SHELL,
        Some(args(json!({
            "_mitaThreadId": "thread-shell",
            "command": "echo hello && echo ok>inside.txt",
            "cwd": workspace,
            "timeoutSeconds": 10,
            "maxOutputBytes": 65536
        }))),
    )
    .await;

    restore_env(RUNNER_PATH_ENV, previous_path);

    let result = result.unwrap();
    let text = result.content[0].as_text().unwrap().text.clone();
    assert!(text.contains("\"success\": true"));
    assert!(text.contains("hello"));
    assert_eq!(
        fs::read_to_string(tmp.path().join("agent-workspaces/thread-shell/inside.txt")).unwrap(),
        "ok\r\n"
    );
}

#[cfg(windows)]
#[test]
fn windows_runner_status_is_available_without_enable_env_when_runner_exists() {
    let _guard = windows_runner_env_lock().lock().unwrap();
    let tmp = tempdir().unwrap();
    let runner = tmp.path().join("mita-computer-agent-runner.exe");
    fs::write(&runner, "").unwrap();

    let previous_path = env::var_os(RUNNER_PATH_ENV);
    env::set_var(RUNNER_PATH_ENV, &runner);

    let status = windows_runner_status();

    restore_env(RUNNER_PATH_ENV, previous_path);

    assert!(status.available);
    assert_eq!(status.runner_path.as_deref(), Some(runner.as_path()));
    assert!(!status
        .blockers
        .iter()
        .any(|blocker| blocker.contains("EXPERIMENTAL")));
}

#[cfg(windows)]
fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
    if let Some(value) = value {
        env::set_var(key, value);
    } else {
        env::remove_var(key);
    }
}

#[cfg(windows)]
struct EnvVarGuard {
    key: &'static str,
    previous: Option<std::ffi::OsString>,
}

#[cfg(windows)]
impl EnvVarGuard {
    fn set(key: &'static str, value: impl AsRef<OsStr>) -> Self {
        let previous = env::var_os(key);
        env::set_var(key, value);
        Self { key, previous }
    }
}

#[cfg(windows)]
impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        restore_env(self.key, self.previous.take());
    }
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_refuses_direct_execution_without_gate() {
    let tmp = tempdir().unwrap();
    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "echo hello".to_string(),
            cwd: tmp.path().to_path_buf(),
            workspace_root: tmp.path().to_path_buf(),
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        false,
    );

    assert_eq!(response.status, RunnerResponseStatus::Refused);
    assert!(response.message.contains(RUNNER_EXECUTE_ENV));
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner --features computer-agent-runner"]
fn macos_runner_refuses_direct_execution_without_gate() {
    let tmp = tempdir().unwrap();
    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "echo hello".to_string(),
            cwd: tmp.path().to_path_buf(),
            workspace_root: tmp.path().to_path_buf(),
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        false,
    );

    assert_eq!(response.status, RunnerResponseStatus::Refused);
    assert!(response.message.contains(RUNNER_EXECUTE_ENV));
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner --features computer-agent-runner"]
fn macos_runner_allows_writes_inside_workspace_and_allowed_root() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let allowed = tmp.path().join("allowed");
    let project = allowed.join("project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&project).unwrap();

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: format!(
                "printf workspace > '{}/workspace.txt'; printf allowed > allowed-root.txt; cat allowed-root.txt",
                workspace.display()
            ),
            cwd: project.clone(),
            workspace_root: workspace.clone(),
            allowed_roots: vec![allowed.clone()],
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_eq!(response.exit_code, Some(0), "{response:?}");
    assert_eq!(response.stdout, "allowed");
    assert_eq!(
        fs::read_to_string(workspace.join("workspace.txt")).unwrap(),
        "workspace"
    );
    assert_eq!(
        fs::read_to_string(project.join("allowed-root.txt")).unwrap(),
        "allowed"
    );
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner --features computer-agent-runner"]
fn macos_runner_blocks_writes_outside_roots() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let outside = tmp.path().join("outside");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&outside).unwrap();
    let outside_file = outside.join("escape.txt");

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: format!("printf nope > '{}'", outside_file.display()),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_ne!(response.exit_code, Some(0), "{response:?}");
    assert!(!outside_file.exists());
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner --features computer-agent-runner"]
fn macos_runner_blocks_loopback_network() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: format!("/bin/bash -c 'cat < /dev/tcp/127.0.0.1/{port}'"),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_ne!(response.exit_code, Some(0), "{response:?}");
    assert!(listener.accept().is_err());
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner --features computer-agent-runner"]
fn macos_runner_timeout_kills_process_group() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "sh -c 'printf started > child-started.txt; sleep 5; printf finished > child-finished.txt' & sleep 5".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace.clone(),
            allowed_roots: Vec::new(),
            timeout_seconds: 1,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert!(response.timed_out, "{response:?}");
    thread::sleep(Duration::from_secs(6));
    assert!(workspace.join("child-started.txt").exists());
    assert!(!workspace.join("child-finished.txt").exists());
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner --features computer-agent-runner"]
fn macos_runner_truncates_large_output() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "yes 012345678901234567890123456789 | head -n 300".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_eq!(response.exit_code, Some(0), "{response:?}");
    assert!(response.stdout.contains("[output truncated]"));
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner --features computer-agent-runner"]
fn macos_runner_allows_dev_null_and_isolated_tmpdir() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command:
                "printf ok >/dev/null; printf tmp > \"$TMPDIR/tmp.txt\"; cat \"$TMPDIR/tmp.txt\""
                    .to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_eq!(response.exit_code, Some(0), "{response:?}");
    assert_eq!(response.stdout, "tmp");
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner --features computer-agent-runner"]
fn macos_runner_rejects_symlink_inside_workspace() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let outside = tmp.path().join("outside");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&outside).unwrap();
    std::os::unix::fs::symlink(&outside, workspace.join("outside-link")).unwrap();

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "printf nope > outside-link/escape.txt".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Error);
    assert!(response
        .message
        .contains("macOS Computer Agent sandbox diagnostic"));
    assert!(response.message.contains("Stage: symlink-scan"));
}

#[cfg(target_os = "macos")]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner --features computer-agent-runner"]
fn macos_runner_scrubs_user_environment() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let canonical_workspace = workspace.canonicalize().unwrap();

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "printf '%s\\n%s\\n%s' \"$HOME\" \"$TMPDIR\" \"${USERPROFILE-unset}\""
                .to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace.clone(),
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_eq!(response.exit_code, Some(0), "{response:?}");
    assert!(response
        .stdout
        .lines()
        .any(|line| line == canonical_workspace.to_string_lossy()));
    assert!(response
        .stdout
        .lines()
        .any(|line| line.contains(".mita-computer-agent-runner-tmp")));
    assert!(response.stdout.lines().any(|line| line == "unset"));
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_blocks_writes_outside_workspace() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let outside = tmp.path().join("outside");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&outside).unwrap();

    let outside_file = outside.join("escape.txt");
    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: format!("echo nope>\"{}\"", outside_file.display()),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_ne!(response.exit_code, Some(0));
    assert!(!outside_file.exists());
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_allows_writes_inside_allowed_root_and_cleans_acl() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let allowed = tmp.path().join("allowed");
    let project = allowed.join("project");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&project).unwrap();

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "echo allowed>inside-allowed-root.txt".to_string(),
            cwd: project.clone(),
            workspace_root: workspace.clone(),
            allowed_roots: vec![allowed.clone()],
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_eq!(response.exit_code, Some(0));
    assert_eq!(
        fs::read_to_string(project.join("inside-allowed-root.txt")).unwrap(),
        "allowed\r\n"
    );
    assert!(
        !workspace_icacls(&workspace).contains("S-1-15-2-"),
        "workspace retained an AppContainer ACL after allowed-root command"
    );
    assert!(
        !workspace_icacls(&allowed).contains("S-1-15-2-"),
        "allowed root retained an AppContainer ACL after command"
    );
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_timeout_cleans_allowed_root_acl() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let allowed = tmp.path().join("allowed");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&allowed).unwrap();

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 5\""
                .to_string(),
            cwd: allowed.clone(),
            workspace_root: workspace.clone(),
            allowed_roots: vec![allowed.clone()],
            timeout_seconds: 1,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert!(response.timed_out, "expected timeout, got: {response:?}");
    assert!(
        !workspace_icacls(&workspace).contains("S-1-15-2-"),
        "workspace retained an AppContainer ACL after timeout"
    );
    assert!(
        !workspace_icacls(&allowed).contains("S-1-15-2-"),
        "allowed root retained an AppContainer ACL after timeout"
    );
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_reports_local_diagnostic_for_missing_workspace() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("missing-workspace");

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "echo nope".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Error);
    assert!(response
        .message
        .contains("Windows Computer Agent sandbox diagnostic"));
    assert!(response.message.contains("Stage: path-resolution"));
    assert!(response
        .message
        .contains("Reason: Failed to resolve workspace root"));
    assert!(response
        .message
        .contains("Telemetry: none; this diagnostic was generated locally."));
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_blocks_user_profile_read_write() {
    let _guard = windows_runner_env_lock().lock().unwrap();
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let profile = tmp.path().join("profile");
    let appdata = tmp.path().join("appdata");
    let local_appdata = tmp.path().join("local-appdata");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&profile).unwrap();
    fs::create_dir_all(&appdata).unwrap();
    fs::create_dir_all(&local_appdata).unwrap();
    fs::write(profile.join("secret.txt"), "profile-secret").unwrap();

    let _userprofile = EnvVarGuard::set("USERPROFILE", &profile);
    let _appdata = EnvVarGuard::set("APPDATA", &appdata);
    let _local_appdata = EnvVarGuard::set("LOCALAPPDATA", &local_appdata);

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "type \"%USERPROFILE%\\secret.txt\" > profile-read.txt & echo nope>\"%APPDATA%\\escape.txt\" & echo nope>\"%LOCALAPPDATA%\\escape.txt\"".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace.clone(),
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    let leaked = fs::read_to_string(workspace.join("profile-read.txt")).unwrap_or_default();
    assert!(
        !leaked.contains("profile-secret"),
        "sandbox command read USERPROFILE content: {response:?}"
    );
    assert!(!appdata.join("escape.txt").exists());
    assert!(!local_appdata.join("escape.txt").exists());
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_blocks_real_hkcu_registry_read_write() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();

    let key = format!(
        r"HKCU\Software\MitaComputerRunnerRegistryRegression\{}",
        unique_test_id()
    );
    reg_delete_key(&key);
    assert!(reg_add_string(&key, "Secret", "registry-secret"));

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: format!(
                "reg query \"{}\" /v Secret > registry-read.txt & reg add \"{}\\WriteAttempt\" /v Escape /t REG_SZ /d nope /f",
                key, key
            ),
            cwd: workspace.clone(),
            workspace_root: workspace.clone(),
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    let leaked = fs::read_to_string(workspace.join("registry-read.txt")).unwrap_or_default();
    assert!(
        !leaked.contains("registry-secret"),
        "sandbox command read real HKCU content: {response:?}"
    );
    assert!(!reg_key_exists(&format!(r"{}\WriteAttempt", key)));
    reg_delete_key(&key);
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_truncates_large_output() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "for /l %i in (1,1,300) do @echo 012345678901234567890123456789".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_eq!(response.exit_code, Some(0));
    assert!(response.stdout.contains("[output truncated]"));
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_timeout_kills_cmd_process_tree() {
    assert_process_tree_child_is_killed(
        "cmd",
        |_| {
            let cmd_exe =
                PathBuf::from(env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()))
                    .join("System32")
                    .join("cmd.exe");
            format!(
                "echo started>cmd-started.txt & start \"\" /b {} /D /S /C powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 5; Set-Content -LiteralPath .\\cmd-finished.txt finished\" & powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 5\"",
                cmd_quoted_path(&cmd_exe)
            )
        },
        false,
    );
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_timeout_kills_powershell_process_tree() {
    assert_process_tree_child_is_killed(
        "powershell",
        |_| {
            "echo started>powershell-started.txt & start \"\" /b %SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 5; Set-Content -LiteralPath .\\powershell-finished.txt finished\" & powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 5\"".to_string()
        },
        false,
    );
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_next_run_cleans_crashed_runner_acl_journal() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let journal = cleanup_journal_path_for_test(&workspace);

    let mut child = spawn_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "echo started>crash-started.txt & powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 20\"".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace.clone(),
            allowed_roots: Vec::new(),
            timeout_seconds: 30,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    if !wait_until(Duration::from_secs(15), || {
        journal.exists() && workspace.join("crash-started.txt").exists()
    }) {
        let diagnostic = format!(
            "journal={}, started={}, journal_path={}",
            journal.exists(),
            workspace.join("crash-started.txt").exists(),
            journal.display()
        );
        if child.try_wait().unwrap().is_some() {
            let response = wait_runner_response(child);
            panic!("runner exited before crash simulation; {diagnostic}; response={response:?}");
        } else {
            let _ = Command::new("taskkill.exe")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .output();
            let _ = child.wait();
            panic!(
                "runner did not reach active sandbox state before crash simulation; {diagnostic}"
            );
        }
    }

    let _ = Command::new("taskkill.exe")
        .args(["/PID", &child.id().to_string(), "/T", "/F"])
        .output();
    let _ = child.wait();
    assert!(
        journal.exists(),
        "crashed runner should leave cleanup journal for the next run"
    );

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "echo recovered>recovered.txt".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace.clone(),
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_eq!(response.exit_code, Some(0));
    assert_eq!(
        fs::read_to_string(workspace.join("recovered.txt")).unwrap(),
        "recovered\r\n"
    );
    assert!(!journal.exists());
    assert!(
        !workspace_icacls(&workspace).contains("S-1-15-2-"),
        "workspace retained an AppContainer ACL after stale cleanup"
    );
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_timeout_kills_node_process_tree() {
    let Some(node) = find_program(&["node.exe"], &[]) else {
        eprintln!("node.exe not found; skipping Node process-tree regression");
        return;
    };
    let script = "require('fs').writeFileSync('node-started.txt','started'); setTimeout(function(){require('fs').writeFileSync('node-finished.txt','finished')},5000)";
    let command = format!(
        "start \"\" /b {} -e \"{}\" & powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 5\"",
        cmd_quoted_path(&node),
        script
    );
    assert_process_tree_child_is_killed("node", |_| command, true);
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_timeout_kills_python_process_tree() {
    let Some(python) = find_program(&["python.exe", "python3.exe"], &[]) else {
        eprintln!("python.exe not found; skipping Python process-tree regression");
        return;
    };
    let script = "import pathlib,time; pathlib.Path('python-started.txt').write_text('started'); time.sleep(5); pathlib.Path('python-finished.txt').write_text('finished')";
    let command = format!(
        "start \"\" /b {} -c \"{}\" & powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 5\"",
        cmd_quoted_path(&python),
        script
    );
    assert_process_tree_child_is_killed("python", |_| command, true);
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_timeout_kills_git_bash_process_tree() {
    let Some(bash) = find_program(
        &["bash.exe"],
        &[
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files\Git\usr\bin\bash.exe",
            r"C:\Program Files (x86)\Git\bin\bash.exe",
        ],
    ) else {
        eprintln!("Git Bash bash.exe not found; skipping Git Bash process-tree regression");
        return;
    };
    let script =
        "printf started > git-bash-started.txt; sleep 5; printf finished > git-bash-finished.txt";
    let command = format!(
        "start \"\" /b {} -lc \"{}\" & powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 5\"",
        cmd_quoted_path(&bash),
        script
    );
    assert_process_tree_child_is_killed("git-bash", |_| command, true);
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_blocks_loopback_network() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let accepted = Arc::new(AtomicBool::new(false));
    let accepted_for_thread = Arc::clone(&accepted);
    let accept_thread = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            match listener.accept() {
                Ok(_) => {
                    accepted_for_thread.store(true, Ordering::SeqCst);
                    return;
                }
                Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(50));
                }
                Err(_) => return,
            }
        }
    });

    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();
    let command = format!(
        "powershell -NoProfile -NonInteractive -Command \"$c = New-Object Net.Sockets.TcpClient; $r = $c.BeginConnect('127.0.0.1', {port}, $null, $null); if ($r.AsyncWaitHandle.WaitOne(2000) -and $c.Connected) {{ exit 0 }} else {{ exit 7 }}\""
    );
    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command,
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    accept_thread.join().unwrap();
    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert_ne!(response.exit_code, Some(0));
    assert!(!accepted.load(Ordering::SeqCst));
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_blocks_junction_escape() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let outside = tmp.path().join("outside");
    let junction = workspace.join("outside-link");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&outside).unwrap();

    if !create_junction(&junction, &outside) {
        return;
    }

    let outside_file = outside.join("escape.txt");
    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "echo nope>outside-link\\escape.txt".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_reparse_response(response);
    assert!(!outside_file.exists());
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_blocks_directory_symlink_escape() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let outside = tmp.path().join("outside");
    let symlink = workspace.join("outside-symlink");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&outside).unwrap();

    if std::os::windows::fs::symlink_dir(&outside, &symlink).is_err() {
        return;
    }

    let outside_file = outside.join("escape.txt");
    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "echo nope>outside-symlink\\escape.txt".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_reparse_response(response);
    assert!(!outside_file.exists());
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-agent-runner and AppContainer support"]
fn windows_runner_blocks_file_symlink_escape() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    let outside = tmp.path().join("outside");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&outside).unwrap();

    let outside_file = outside.join("escape.txt");
    fs::write(&outside_file, "original").unwrap();
    if std::os::windows::fs::symlink_file(&outside_file, workspace.join("escape-link.txt")).is_err()
    {
        return;
    }

    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "echo nope>escape-link.txt".to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_reparse_response(response);
    assert_eq!(fs::read_to_string(outside_file).unwrap(), "original");
}

#[cfg(windows)]
fn assert_reparse_response(response: RunnerResponse) {
    assert_eq!(response.status, RunnerResponseStatus::Error);
    assert!(
        response
            .message
            .contains("Windows Computer Agent sandbox diagnostic"),
        "expected local diagnostic, got: {response:?}"
    );
    assert!(
        response.message.contains("Stage: workspace-reparse-scan"),
        "expected reparse scan stage, got: {response:?}"
    );
    assert!(
        response
            .message
            .to_ascii_lowercase()
            .contains("reparse point"),
        "expected reparse point rejection, got: {response:?}"
    );
}

#[cfg(windows)]
fn assert_process_tree_child_is_killed<F>(label: &str, build_command: F, optional_tool: bool)
where
    F: FnOnce(&Path) -> String,
{
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();

    let started_file = workspace.join(format!("{label}-started.txt"));
    let finished_file = workspace.join(format!("{label}-finished.txt"));
    let command = build_command(&workspace);
    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command,
            cwd: workspace.clone(),
            workspace_root: workspace,
            allowed_roots: Vec::new(),
            timeout_seconds: 2,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    if optional_tool && response.status == RunnerResponseStatus::Completed && !response.timed_out {
        eprintln!(
            "{label} did not stay running inside AppContainer; skipping optional process-tree assertion. stdout={} stderr={}",
            response.stdout, response.stderr
        );
        return;
    }

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert!(response.timed_out, "expected timeout, got: {response:?}");
    thread::sleep(Duration::from_secs(6));

    if optional_tool && !started_file.exists() {
        eprintln!(
            "{label} did not start inside AppContainer; skipping optional process-tree assertion. stdout={} stderr={}",
            response.stdout, response.stderr
        );
        return;
    }

    assert!(
        started_file.exists(),
        "{label} child process did not create its startup marker"
    );
    assert!(
        !finished_file.exists(),
        "{label} child process survived the runner timeout"
    );
}

#[cfg(windows)]
fn find_program(names: &[&str], common_paths: &[&str]) -> Option<PathBuf> {
    for path in common_paths {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Some(path);
        }
    }

    for name in names {
        let output = Command::new("where.exe").arg(name).output().ok()?;
        if !output.status.success() {
            continue;
        }
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            let path = PathBuf::from(line.trim());
            if path.is_file() {
                return Some(path);
            }
        }
    }

    None
}

#[cfg(windows)]
fn cmd_quoted_path(path: &Path) -> String {
    format!("\"{}\"", path.display())
}

#[cfg(windows)]
fn unique_test_id() -> String {
    format!(
        "{}-{}",
        std::process::id(),
        Instant::now().elapsed().as_nanos()
    )
}

#[cfg(windows)]
fn reg_add_string(key: &str, name: &str, value: &str) -> bool {
    Command::new("reg.exe")
        .args(["add", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn reg_key_exists(key: &str) -> bool {
    Command::new("reg.exe")
        .args(["query", key])
        .output()
        .map(|output| output.status.success())
        .unwrap_or(false)
}

#[cfg(windows)]
fn reg_delete_key(key: &str) {
    let _ = Command::new("reg.exe").args(["delete", key, "/f"]).output();
}

#[cfg(windows)]
fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if condition() {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    condition()
}

#[cfg(windows)]
fn workspace_icacls(workspace: &Path) -> String {
    let output = Command::new("icacls")
        .arg(workspace)
        .output()
        .expect("icacls should run");
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

#[cfg(windows)]
fn windows_runner_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(any(windows, target_os = "macos"))]
fn run_runner_request(request: RunnerRequest, execute: bool) -> RunnerResponse {
    wait_runner_response(spawn_runner_request(request, execute))
}

#[cfg(any(windows, target_os = "macos"))]
fn spawn_runner_request(request: RunnerRequest, execute: bool) -> Child {
    let runner = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("debug")
        .join(RUNNER_BINARY_NAME);
    assert!(
        runner.is_file(),
        "runner binary not found at {}; run cargo build --bin mita-computer-agent-runner first",
        runner.display()
    );

    let mut command = Command::new(runner);
    command.arg("run").env_remove(RUNNER_EXECUTE_ENV);
    if execute {
        command.env(RUNNER_EXECUTE_ENV, "1");
    }

    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    let request_json = serde_json::to_vec(&request).unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&request_json)
        .unwrap();
    drop(child.stdin.take());
    child
}

#[cfg(any(windows, target_os = "macos"))]
fn wait_runner_response(child: Child) -> RunnerResponse {
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "runner process failed: status={}; stderr={}",
        output.status,
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[cfg(windows)]
fn create_junction(link: &Path, target: &Path) -> bool {
    let status = Command::new("cmd")
        .args([
            "/D",
            "/S",
            "/C",
            &format!("mklink /J \"{}\" \"{}\"", link.display(), target.display()),
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    status.is_ok_and(|status| status.success())
}
