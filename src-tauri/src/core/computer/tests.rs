use std::fs;

#[cfg(windows)]
use std::{
    env,
    io::Write,
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Map};
use tempfile::tempdir;

use crate::core::{
    computer::{
        handlers::handle_computer_tool,
        permissions::{sanitize_file_stem, unique_txt_path, ComputerScope},
        tools::{computer_tools, CREATE_TEXT_FILE, READ_TEXT_FILE, RUN_SHELL},
        windows_runner::{
            refused_response, runner_candidate_paths_from, validate_runner_request, RunnerRequest,
            RunnerResponse, RunnerResponseStatus, RUNNER_ENABLE_ENV, RUNNER_EXECUTE_ENV,
            RUNNER_PATH_ENV, RUNNER_PROTOCOL_VERSION,
        },
    },
    mcp::models::McpSettings,
};

fn settings_enabled() -> McpSettings {
    McpSettings {
        computer_use_enabled: true,
        ..McpSettings::default()
    }
}

fn args(value: serde_json::Value) -> Map<String, serde_json::Value> {
    value.as_object().cloned().unwrap_or_default()
}

#[test]
fn default_scope_allows_thread_workspace() {
    let tmp = tempdir().unwrap();
    let scope = ComputerScope::new(tmp.path(), "thread-1", &[]).unwrap();
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

    let scope = ComputerScope::new(&data, "t1", &[]).unwrap();
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

    let scope = ComputerScope::new(&data, "t1", &[]).unwrap();
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
fn computer_tools_hide_shell_when_unavailable() {
    let mut settings = settings_enabled();
    settings.computer_shell_enabled = true;

    let tools = computer_tools(&settings, false);
    assert!(!tools.iter().any(|tool| tool.name == "computer_run_shell"));
}

#[test]
fn computer_tools_show_shell_when_enabled_and_available() {
    let mut settings = settings_enabled();
    settings.computer_shell_enabled = true;

    let tools = computer_tools(&settings, true);
    assert!(tools.iter().any(|tool| tool.name == "computer_run_shell"));
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
        r"C:\Program Files\Mita\resources\bin\mita-computer-runner.exe"
    )));
    assert!(candidates.contains(&PathBuf::from(
        r"C:\Program Files\Mita\resources\computer-runner\mita-computer-runner.exe"
    )));
    assert!(candidates.contains(&PathBuf::from(
        r"E:\codexprojects\Mita\src-tauri\resources\computer-runner\mita-computer-runner.exe"
    )));
    assert!(candidates.contains(&PathBuf::from(
        r"E:\codexprojects\Mita\src-tauri\target\debug\mita-computer-runner.exe"
    )));
}

#[tokio::test]
async fn create_and_read_text_file_in_thread_workspace() {
    let tmp = tempdir().unwrap();
    let mut create_args = args(json!({
        "_mitaThreadId": "thread-1",
        "suggestedName": "Meeting Notes",
        "content": "  hello\n"
    }));

    let created = handle_computer_tool(
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
    let read = handle_computer_tool(
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
    settings.computer_shell_enabled = true;

    let result = handle_computer_tool(
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
#[ignore = "requires cargo build --bin mita-computer-runner and AppContainer support"]
async fn windows_shell_runs_through_runner_when_enabled() {
    let _guard = windows_runner_env_lock().lock().unwrap();
    let runner = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("debug")
        .join("mita-computer-runner.exe");
    assert!(
        runner.is_file(),
        "runner binary not found at {}; run cargo build --bin mita-computer-runner first",
        runner.display()
    );

    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("agent-workspaces").join("thread-shell");
    fs::create_dir_all(&workspace).unwrap();

    let previous_enable = env::var_os(RUNNER_ENABLE_ENV);
    let previous_path = env::var_os(RUNNER_PATH_ENV);
    env::set_var(RUNNER_ENABLE_ENV, "1");
    env::set_var(RUNNER_PATH_ENV, &runner);

    let result = handle_computer_tool(
        tmp.path().to_path_buf(),
        McpSettings {
            computer_use_enabled: true,
            computer_shell_enabled: true,
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

    restore_env(RUNNER_ENABLE_ENV, previous_enable);
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
fn restore_env(key: &str, value: Option<std::ffi::OsString>) {
    if let Some(value) = value {
        env::set_var(key, value);
    } else {
        env::remove_var(key);
    }
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-runner and AppContainer support"]
fn windows_runner_refuses_direct_execution_without_gate() {
    let tmp = tempdir().unwrap();
    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: "echo hello".to_string(),
            cwd: tmp.path().to_path_buf(),
            workspace_root: tmp.path().to_path_buf(),
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        false,
    );

    assert_eq!(response.status, RunnerResponseStatus::Refused);
    assert!(response.message.contains(RUNNER_EXECUTE_ENV));
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-runner and AppContainer support"]
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
#[ignore = "requires cargo build --bin mita-computer-runner and AppContainer support"]
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
#[ignore = "requires cargo build --bin mita-computer-runner and AppContainer support"]
fn windows_runner_timeout_kills_process_tree() {
    let tmp = tempdir().unwrap();
    let workspace = tmp.path().join("workspace");
    fs::create_dir_all(&workspace).unwrap();

    let child_file = workspace.join("child.txt");
    let command = "start \"\" /b powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 5; Set-Content -LiteralPath child.txt child\" & powershell -NoProfile -NonInteractive -Command \"Start-Sleep -Seconds 5\"";
    let response = run_runner_request(
        RunnerRequest {
            protocol_version: RUNNER_PROTOCOL_VERSION,
            command: command.to_string(),
            cwd: workspace.clone(),
            workspace_root: workspace,
            timeout_seconds: 1,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert!(response.timed_out);
    thread::sleep(Duration::from_secs(6));
    assert!(!child_file.exists());
}

#[cfg(windows)]
#[test]
#[ignore = "requires cargo build --bin mita-computer-runner and AppContainer support"]
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
#[ignore = "requires cargo build --bin mita-computer-runner and AppContainer support"]
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
            timeout_seconds: 10,
            max_output_bytes: 64 * 1024,
        },
        true,
    );

    assert_eq!(response.status, RunnerResponseStatus::Completed);
    assert!(!outside_file.exists());
}

#[cfg(windows)]
fn windows_runner_env_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

#[cfg(windows)]
fn run_runner_request(request: RunnerRequest, execute: bool) -> RunnerResponse {
    let runner = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target")
        .join("debug")
        .join("mita-computer-runner.exe");
    assert!(
        runner.is_file(),
        "runner binary not found at {}; run cargo build --bin mita-computer-runner first",
        runner.display()
    );

    let mut command = Command::new(runner);
    command.arg("run").env_remove(RUNNER_EXECUTE_ENV);
    if execute {
        command.env(RUNNER_EXECUTE_ENV, "1");
    }

    let child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    write_runner_request(child, &request)
}

#[cfg(windows)]
fn write_runner_request(mut child: std::process::Child, request: &RunnerRequest) -> RunnerResponse {
    let request_json = serde_json::to_vec(request).unwrap();
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(&request_json)
        .unwrap();
    drop(child.stdin.take());

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
