use std::{path::PathBuf, process::Stdio, time::Duration};

use serde::Serialize;
#[cfg(not(windows))]
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::{process::Command, time::timeout};

use super::permissions::ComputerAgentScope;
#[cfg(windows)]
use super::windows_runner::{
    discover_runner_binary, windows_runner_status, RunnerRequest, RunnerResponse,
    RunnerResponseStatus, RUNNER_EXECUTE_ENV, RUNNER_PROTOCOL_VERSION,
};

const DEFAULT_TIMEOUT_SECS: u64 = 30;
const MAX_OUTPUT_BYTES: usize = 64 * 1024;
const MIN_OUTPUT_BYTES: usize = 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellStatus {
    pub platform: String,
    pub available: bool,
    pub reason: Option<String>,
    pub sandbox_kind: String,
    pub phase: Option<String>,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ShellRequest {
    pub command: String,
    pub cwd: PathBuf,
    pub timeout_seconds: u64,
    pub max_output_bytes: usize,
}

pub fn shell_status() -> ShellStatus {
    let platform = std::env::consts::OS.to_string();

    #[cfg(windows)]
    {
        let runner = windows_runner_status();
        return ShellStatus {
            platform,
            available: runner.available,
            reason: Some(runner.reason),
            sandbox_kind: "windows-native-runner".to_string(),
            phase: Some(runner.phase),
            blockers: runner.blockers,
        };
    }

    #[cfg(target_os = "linux")]
    {
        if find_on_path("bwrap")
            .or_else(|| find_on_path("bubblewrap"))
            .is_some()
        {
            return ShellStatus {
                platform,
                available: true,
                reason: None,
                sandbox_kind: "bubblewrap".to_string(),
                phase: Some("available".to_string()),
                blockers: Vec::new(),
            };
        }

        return ShellStatus {
            platform,
            available: false,
            reason: Some("bubblewrap (bwrap) was not found on PATH.".to_string()),
            sandbox_kind: "bubblewrap".to_string(),
            phase: Some("missing-dependency".to_string()),
            blockers: vec!["Install bubblewrap (bwrap) to enable Computer Agent shell.".to_string()],
        };
    }

    #[cfg(target_os = "macos")]
    {
        if PathBuf::from("/usr/bin/sandbox-exec").exists() {
            return ShellStatus {
                platform,
                available: true,
                reason: None,
                sandbox_kind: "seatbelt".to_string(),
                phase: Some("available".to_string()),
                blockers: Vec::new(),
            };
        }

        return ShellStatus {
            platform,
            available: false,
            reason: Some("sandbox-exec was not found.".to_string()),
            sandbox_kind: "seatbelt".to_string(),
            phase: Some("missing-dependency".to_string()),
            blockers: vec!["sandbox-exec is required to enable Computer Agent shell.".to_string()],
        };
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        ShellStatus {
            platform,
            available: false,
            reason: Some(
                "Computer Agent shell sandbox is not supported on this platform.".to_string(),
            ),
            sandbox_kind: "unsupported".to_string(),
            phase: Some("unsupported-platform".to_string()),
            blockers: vec!["No shell sandbox runner is defined for this platform.".to_string()],
        }
    }
}

pub fn normalize_timeout(value: Option<u64>) -> u64 {
    value
        .unwrap_or(DEFAULT_TIMEOUT_SECS)
        .clamp(1, DEFAULT_TIMEOUT_SECS)
}

pub fn normalize_output_cap(value: Option<u64>) -> usize {
    value
        .map(|v| v as usize)
        .unwrap_or(MAX_OUTPUT_BYTES)
        .clamp(MIN_OUTPUT_BYTES, MAX_OUTPUT_BYTES)
}

pub async fn run_shell(
    scope: &ComputerAgentScope,
    request: ShellRequest,
) -> Result<String, String> {
    let status = shell_status();
    if !status.available {
        return Err(status
            .reason
            .unwrap_or_else(|| "Computer Agent shell sandbox is not available".to_string()));
    }

    if request.command.trim().is_empty() {
        return Err("Shell command is required".to_string());
    }

    if request.command.contains('\0') {
        return Err("Shell command contains an invalid null byte".to_string());
    }

    #[cfg(windows)]
    {
        run_windows_runner(scope, request).await
    }

    #[cfg(not(windows))]
    {
        let mut command = sandboxed_command(scope, &request)?;
        command.stdin(Stdio::null());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());
        command.kill_on_drop(true);

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start sandboxed shell: {e}"))?;

        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture shell stdout".to_string())?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture shell stderr".to_string())?;

        let stdout_cap = request.max_output_bytes;
        let stderr_cap = request.max_output_bytes;
        let stdout_task = tokio::spawn(async move { read_limited(&mut stdout, stdout_cap).await });
        let stderr_task = tokio::spawn(async move { read_limited(&mut stderr, stderr_cap).await });

        let wait_result = timeout(Duration::from_secs(request.timeout_seconds), child.wait()).await;

        let status = match wait_result {
            Ok(Ok(status)) => status,
            Ok(Err(e)) => return Err(format!("Failed while waiting for shell command: {e}")),
            Err(_) => {
                let _ = child.kill().await;
                return Err(format!(
                    "Shell command timed out after {} seconds",
                    request.timeout_seconds
                ));
            }
        };

        let stdout = stdout_task
            .await
            .map_err(|e| format!("Failed to read shell stdout: {e}"))??;
        let stderr = stderr_task
            .await
            .map_err(|e| format!("Failed to read shell stderr: {e}"))??;

        let output = serde_json::json!({
            "exitCode": status.code(),
            "success": status.success(),
            "stdout": stdout,
            "stderr": stderr,
            "cwd": request.cwd,
            "timedOut": false,
        });

        Ok(serde_json::to_string_pretty(&output).unwrap_or_else(|_| output.to_string()))
    }
}

#[cfg(windows)]
async fn run_windows_runner(
    scope: &ComputerAgentScope,
    request: ShellRequest,
) -> Result<String, String> {
    use tokio::io::AsyncWriteExt;

    if !super::permissions::is_within_root(&request.cwd, &scope.workspace_root) {
        return Err(
            "Windows Computer Agent shell phase 1 only supports the private thread workspace"
                .to_string(),
        );
    }

    let runner = discover_runner_binary()
        .ok_or_else(|| "Windows Computer Agent runner binary was not found".to_string())?;
    let runner_request = RunnerRequest {
        protocol_version: RUNNER_PROTOCOL_VERSION,
        command: request.command,
        cwd: request.cwd.clone(),
        workspace_root: scope.workspace_root.clone(),
        timeout_seconds: request.timeout_seconds,
        max_output_bytes: request.max_output_bytes,
    };
    let request_json = serde_json::to_vec(&runner_request)
        .map_err(|e| format!("Failed to serialize Windows runner request: {e}"))?;

    let mut command = Command::new(runner);
    command.arg("run");
    command.env(RUNNER_EXECUTE_ENV, "1");
    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.kill_on_drop(true);

    let mut child = command
        .spawn()
        .map_err(|e| format!("Failed to start Windows Computer Agent runner: {e}"))?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Failed to open Windows runner stdin".to_string())?;
    stdin
        .write_all(&request_json)
        .await
        .map_err(|e| format!("Failed to write Windows runner request: {e}"))?;
    drop(stdin);

    let wait_budget = Duration::from_secs(request.timeout_seconds.saturating_add(5));
    let output = timeout(wait_budget, child.wait_with_output())
        .await
        .map_err(|_| {
            format!(
                "Windows Computer Agent runner timed out after {} seconds",
                wait_budget.as_secs()
            )
        })?
        .map_err(|e| format!("Failed while waiting for Windows runner: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Windows runner exited with status {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let response: RunnerResponse = serde_json::from_slice(&output.stdout).map_err(|e| {
        format!(
            "Failed to parse Windows runner response: {e}; stdout: {}; stderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })?;

    if response.status != RunnerResponseStatus::Completed {
        return Err(response.message);
    }

    let tool_output = serde_json::json!({
        "exitCode": response.exit_code,
        "success": response.exit_code == Some(0) && !response.timed_out,
        "stdout": response.stdout,
        "stderr": response.stderr,
        "cwd": request.cwd,
        "timedOut": response.timed_out,
        "sandbox": "windows-native-runner",
        "phase": "phase-1-workspace-prototype",
    });

    Ok(serde_json::to_string_pretty(&tool_output).unwrap_or_else(|_| tool_output.to_string()))
}

#[cfg(not(windows))]
async fn read_limited<R>(reader: &mut R, cap: usize) -> Result<String, String>
where
    R: AsyncRead + Unpin,
{
    let mut collected = Vec::with_capacity(cap.min(8192));
    let mut truncated = false;
    let mut chunk = [0u8; 8192];

    loop {
        let n = reader
            .read(&mut chunk)
            .await
            .map_err(|e| format!("Failed to read process output: {e}"))?;
        if n == 0 {
            break;
        }
        let remaining = cap.saturating_sub(collected.len());
        if remaining > 0 {
            let to_copy = remaining.min(n);
            collected.extend_from_slice(&chunk[..to_copy]);
        }
        if n > remaining {
            truncated = true;
        }
    }

    let mut text = String::from_utf8_lossy(&collected).to_string();
    if truncated {
        text.push_str("\n[output truncated]");
    }
    Ok(text)
}

#[cfg(not(windows))]
fn sandboxed_command(
    scope: &ComputerAgentScope,
    request: &ShellRequest,
) -> Result<Command, String> {
    #[cfg(target_os = "linux")]
    {
        let bwrap = find_on_path("bwrap")
            .or_else(|| find_on_path("bubblewrap"))
            .ok_or_else(|| "bubblewrap (bwrap) was not found on PATH".to_string())?;
        let mut cmd = Command::new(bwrap);
        cmd.args([
            "--die-with-parent",
            "--unshare-net",
            "--proc",
            "/proc",
            "--dev",
            "/dev",
            "--tmpfs",
            "/tmp",
            "--ro-bind",
            "/usr",
            "/usr",
            "--ro-bind",
            "/bin",
            "/bin",
            "--ro-bind",
            "/lib",
            "/lib",
            "--ro-bind",
            "/etc",
            "/etc",
        ]);

        if PathBuf::from("/lib64").exists() {
            cmd.args(["--ro-bind", "/lib64", "/lib64"]);
        }

        for root in &scope.allowed_roots {
            cmd.arg("--bind").arg(root).arg(root);
        }

        cmd.arg("--chdir").arg(&request.cwd);
        cmd.args(["/bin/sh", "-lc", &request.command]);
        return Ok(cmd);
    }

    #[cfg(target_os = "macos")]
    {
        let mut profile = String::from(
            "(version 1)\n(deny default)\n(allow process*)\n(allow file-read*)\n(allow sysctl*)\n",
        );
        for root in &scope.allowed_roots {
            profile.push_str(&format!(
                "(allow file-write* (subpath \"{}\"))\n",
                escape_seatbelt_path(root)
            ));
        }

        let mut cmd = Command::new("/usr/bin/sandbox-exec");
        cmd.arg("-p")
            .arg(profile)
            .arg("/bin/sh")
            .arg("-lc")
            .arg(&request.command);
        cmd.current_dir(&request.cwd);
        return Ok(cmd);
    }

    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = scope;
        let _ = request;
        Err("Computer Agent shell sandbox is not supported on this platform.".to_string())
    }
}

#[cfg(target_os = "linux")]
fn find_on_path(binary: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|dir| dir.join(binary))
        .find(|candidate| candidate.is_file())
}

#[cfg(target_os = "macos")]
fn escape_seatbelt_path(path: &PathBuf) -> String {
    path.to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}
