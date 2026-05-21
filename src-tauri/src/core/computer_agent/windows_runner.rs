use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const RUNNER_PROTOCOL_VERSION: u32 = 2;
pub const RUNNER_BINARY_NAME: &str = if cfg!(windows) {
    "mita-computer-agent-runner.exe"
} else {
    "mita-computer-agent-runner"
};
pub const RUNNER_PATH_ENV: &str = "MITA_COMPUTER_AGENT_RUNNER";
pub const LEGACY_WINDOWS_RUNNER_PATH_ENV: &str = "MITA_WINDOWS_COMPUTER_AGENT_RUNNER";
pub const RUNNER_EXECUTE_ENV: &str = "MITA_COMPUTER_AGENT_RUNNER_EXECUTE";
pub const RUNNER_PHASE: &str = if cfg!(target_os = "macos") {
    "phase-4-macos-seatbelt-runner"
} else {
    "phase-3-allowed-roots"
};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComputerAgentRunnerStatus {
    pub available: bool,
    pub phase: String,
    pub runner_path: Option<PathBuf>,
    pub reason: String,
    pub blockers: Vec<String>,
}

pub type WindowsRunnerStatus = ComputerAgentRunnerStatus;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunnerRequest {
    pub protocol_version: u32,
    pub command: String,
    pub cwd: PathBuf,
    pub workspace_root: PathBuf,
    #[serde(default)]
    pub allowed_roots: Vec<PathBuf>,
    pub timeout_seconds: u64,
    pub max_output_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunnerResponse {
    pub protocol_version: u32,
    pub status: RunnerResponseStatus,
    pub message: String,
    pub exit_code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum RunnerResponseStatus {
    Ready,
    Completed,
    Refused,
    Error,
}

pub fn computer_agent_runner_status() -> ComputerAgentRunnerStatus {
    let runner_path = discover_runner_binary();
    let mut blockers = Vec::new();

    if runner_path.is_none() {
        blockers.push(format!(
            "{RUNNER_BINARY_NAME} was not found next to the app or in {RUNNER_PATH_ENV}"
        ));
    }

    #[cfg(target_os = "macos")]
    if !Path::new("/usr/bin/sandbox-exec").is_file() {
        blockers.push("sandbox-exec was not found at /usr/bin/sandbox-exec".to_string());
    }

    let available = blockers.is_empty();
    ComputerAgentRunnerStatus {
        available,
        phase: RUNNER_PHASE.to_string(),
        runner_path,
        reason: if available {
            format!(
                "{} Computer Agent shell runner is available; chats still require the Computer Agent shell setting and per-action approval.",
                runner_platform_label()
            )
                .to_string()
        } else {
            format!(
                "{} Computer Agent shell runner is not available.",
                runner_platform_label()
            )
        },
        blockers,
    }
}

pub fn windows_runner_status() -> ComputerAgentRunnerStatus {
    computer_agent_runner_status()
}

pub fn preflight_response() -> RunnerResponse {
    RunnerResponse {
        protocol_version: RUNNER_PROTOCOL_VERSION,
        status: RunnerResponseStatus::Ready,
        message: format!(
            "{} runner protocol {RUNNER_PROTOCOL_VERSION} is available",
            runner_platform_label()
        ),
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        timed_out: false,
    }
}

pub fn execute_runner_request(request: RunnerRequest) -> RunnerResponse {
    if let Err(error) = validate_runner_request(&request) {
        return refused_response(error);
    }

    if std::env::var(RUNNER_EXECUTE_ENV).as_deref() != Ok("1") {
        return refused_response(format!(
            "{RUNNER_EXECUTE_ENV}=1 is required; the desktop app sets it only when brokering an approved Computer Agent shell command"
        ));
    }

    #[cfg(windows)]
    {
        native::execute_sandboxed(request)
    }

    #[cfg(target_os = "macos")]
    {
        macos_native::execute_sandboxed(request)
    }

    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = request;
        refused_response("The Computer Agent runner only executes on supported desktop platforms.")
    }
}

pub fn completed_response(
    message: impl Into<String>,
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    timed_out: bool,
) -> RunnerResponse {
    RunnerResponse {
        protocol_version: RUNNER_PROTOCOL_VERSION,
        status: RunnerResponseStatus::Completed,
        message: message.into(),
        exit_code,
        stdout,
        stderr,
        timed_out,
    }
}

pub fn refused_response(message: impl Into<String>) -> RunnerResponse {
    RunnerResponse {
        protocol_version: RUNNER_PROTOCOL_VERSION,
        status: RunnerResponseStatus::Refused,
        message: message.into(),
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        timed_out: false,
    }
}

pub fn error_response(message: impl Into<String>) -> RunnerResponse {
    RunnerResponse {
        protocol_version: RUNNER_PROTOCOL_VERSION,
        status: RunnerResponseStatus::Error,
        message: message.into(),
        exit_code: None,
        stdout: String::new(),
        stderr: String::new(),
        timed_out: false,
    }
}

fn runner_platform_label() -> &'static str {
    if cfg!(windows) {
        "Windows"
    } else if cfg!(target_os = "macos") {
        "macOS"
    } else {
        "Computer Agent"
    }
}

#[cfg(windows)]
const DIAGNOSTIC_PREFIX: &str = "Windows Computer Agent sandbox diagnostic";

#[cfg(windows)]
fn sandbox_diagnostic(stage: &str, reason: impl AsRef<str>, next_step: &str) -> String {
    let reason = reason.as_ref();
    if reason.starts_with(DIAGNOSTIC_PREFIX) {
        return reason.to_string();
    }

    format!(
        "{DIAGNOSTIC_PREFIX}\n\
Stage: {stage}\n\
Reason: {reason}\n\
Phase: {RUNNER_PHASE}\n\
Next step: {next_step}\n\
Telemetry: none; this diagnostic was generated locally."
    )
}

#[cfg(all(windows, test))]
pub(crate) fn sandbox_diagnostic_for_test(stage: &str, reason: &str, next_step: &str) -> String {
    sandbox_diagnostic(stage, reason, next_step)
}

#[cfg(all(not(windows), test))]
#[allow(dead_code)]
pub(crate) fn sandbox_diagnostic_for_test(stage: &str, reason: &str, next_step: &str) -> String {
    format!("Stage: {stage}\nReason: {reason}\nNext step: {next_step}")
}

#[cfg(all(windows, test))]
pub(crate) fn cleanup_journal_path_for_test(workspace_root: &Path) -> PathBuf {
    let workspace = workspace_root
        .canonicalize()
        .unwrap_or_else(|_| workspace_root.to_path_buf());
    native::cleanup_journal_path_for_test(&workspace)
}

#[cfg(all(not(windows), test))]
#[allow(dead_code)]
pub(crate) fn cleanup_journal_path_for_test(workspace_root: &Path) -> PathBuf {
    workspace_root.join(".mita-computer-agent-runner-cleanup-unused")
}

pub fn validate_runner_request(request: &RunnerRequest) -> Result<(), String> {
    if request.protocol_version != RUNNER_PROTOCOL_VERSION {
        return Err(format!(
            "Unsupported runner protocol version {}; expected {}",
            request.protocol_version, RUNNER_PROTOCOL_VERSION
        ));
    }

    if request.command.trim().is_empty() {
        return Err("Runner command is required".to_string());
    }

    if request.command.contains('\0') {
        return Err("Runner command contains an invalid null byte".to_string());
    }

    if request.timeout_seconds == 0 || request.timeout_seconds > 30 {
        return Err("Runner timeout must be between 1 and 30 seconds".to_string());
    }

    if request.max_output_bytes < 1024 || request.max_output_bytes > 64 * 1024 {
        return Err("Runner output cap must be between 1024 and 65536 bytes".to_string());
    }

    let workspace = normalize_lexical(&request.workspace_root);
    if !workspace.is_absolute() {
        return Err("Runner workspace root must be an absolute path".to_string());
    }

    let cwd = normalize_lexical(&request.cwd);
    if !cwd.is_absolute() {
        return Err("Runner cwd must be an absolute path".to_string());
    }

    let roots = runner_allowed_roots(request);
    for root in &roots {
        if !root.is_absolute() {
            return Err("Runner allowed roots must be absolute paths".to_string());
        }
        if is_filesystem_root(root) {
            return Err("Runner allowed roots cannot be filesystem roots".to_string());
        }
    }

    if !roots.iter().any(|root| path_starts_with(&cwd, root)) {
        return Err(
            "Runner cwd must stay inside the thread workspace or configured allowed roots"
                .to_string(),
        );
    }

    Ok(())
}

pub fn discover_runner_binary() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(RUNNER_PATH_ENV).map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }
    if let Some(path) = std::env::var_os(LEGACY_WINDOWS_RUNNER_PATH_ENV).map(PathBuf::from) {
        if path.is_file() {
            return Some(path);
        }
    }

    let current_exe = std::env::current_exe().ok()?;
    runner_candidate_paths_from(&current_exe, Some(Path::new(env!("CARGO_MANIFEST_DIR"))))
        .into_iter()
        .find(|candidate| candidate.is_file())
}

pub fn runner_candidate_paths_from(
    current_exe: &Path,
    manifest_dir: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Some(app_dir) = current_exe.parent() {
        push_candidate(&mut candidates, app_dir.join(RUNNER_BINARY_NAME));
        push_candidate(
            &mut candidates,
            app_dir
                .join("resources")
                .join("bin")
                .join(RUNNER_BINARY_NAME),
        );
        push_candidate(
            &mut candidates,
            app_dir
                .join("resources")
                .join("computer-agent-runner")
                .join(RUNNER_BINARY_NAME),
        );
        if let Some(parent) = app_dir.parent() {
            push_candidate(
                &mut candidates,
                parent
                    .join("resources")
                    .join("bin")
                    .join(RUNNER_BINARY_NAME),
            );
            push_candidate(
                &mut candidates,
                parent
                    .join("resources")
                    .join("computer-agent-runner")
                    .join(RUNNER_BINARY_NAME),
            );
        }
    }

    if let Some(manifest_dir) = manifest_dir {
        push_candidate(
            &mut candidates,
            manifest_dir
                .join("resources")
                .join("bin")
                .join(RUNNER_BINARY_NAME),
        );
        push_candidate(
            &mut candidates,
            manifest_dir
                .join("resources")
                .join("computer-agent-runner")
                .join(RUNNER_BINARY_NAME),
        );
        push_candidate(
            &mut candidates,
            manifest_dir
                .join("target")
                .join("debug")
                .join(RUNNER_BINARY_NAME),
        );
        push_candidate(
            &mut candidates,
            manifest_dir
                .join("target")
                .join("release")
                .join(RUNNER_BINARY_NAME),
        );
    }

    candidates
}

fn push_candidate(candidates: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !candidates.iter().any(|existing| existing == &candidate) {
        candidates.push(candidate);
    }
}

fn runner_allowed_roots(request: &RunnerRequest) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    push_root(&mut roots, normalize_lexical(&request.workspace_root));
    for root in &request.allowed_roots {
        push_root(&mut roots, normalize_lexical(root));
    }
    roots
}

fn push_root(roots: &mut Vec<PathBuf>, root: PathBuf) {
    if !roots.iter().any(|existing| paths_equal(existing, &root)) {
        roots.push(root);
    }
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    path_starts_with(left, right) && path_starts_with(right, left)
}

fn is_filesystem_root(path: &Path) -> bool {
    path.parent().is_none()
}

fn path_starts_with(path: &Path, root: &Path) -> bool {
    #[cfg(windows)]
    {
        let path = path.to_string_lossy().to_ascii_lowercase();
        let root = root.to_string_lossy().to_ascii_lowercase();
        return path == root
            || path
                .strip_prefix(&root)
                .is_some_and(|suffix| suffix.starts_with('\\') || suffix.starts_with('/'));
    }

    #[cfg(not(windows))]
    {
        path.starts_with(root)
    }
}

fn normalize_lexical(path: &Path) -> PathBuf {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            _ => normalized.push(component.as_os_str()),
        }
    }
    normalized
}

#[cfg(target_os = "macos")]
mod macos_native {
    use std::{
        fs,
        io::Read,
        os::unix::process::{CommandExt, ExitStatusExt},
        path::{Path, PathBuf},
        process::{Command, Stdio},
        thread,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    use super::{completed_response, error_response, RunnerRequest, RunnerResponse};

    const DIAGNOSTIC_PREFIX: &str = "macOS Computer Agent sandbox diagnostic";
    const TEMP_DIR_NAME: &str = ".mita-computer-agent-runner-tmp";

    pub fn execute_sandboxed(request: RunnerRequest) -> RunnerResponse {
        match execute_sandboxed_inner(request) {
            Ok(response) => response,
            Err(error) => error_response(error),
        }
    }

    fn execute_sandboxed_inner(request: RunnerRequest) -> Result<RunnerResponse, String> {
        if !Path::new("/usr/bin/sandbox-exec").is_file() {
            return Err(sandbox_diagnostic(
                "sandbox-runtime",
                "sandbox-exec was not found at /usr/bin/sandbox-exec",
                "Confirm macOS still provides sandbox-exec before enabling Computer Agent shell.",
            ));
        }

        let workspace = canonical_directory(&request.workspace_root).map_err(|e| {
            sandbox_diagnostic(
                "path-resolution",
                format!(
                    "Failed to resolve workspace root {}: {e}",
                    request.workspace_root.display()
                ),
                "Confirm the thread workspace exists and is accessible, then retry the command.",
            )
        })?;
        let cwd = canonical_directory(&request.cwd).map_err(|e| {
            sandbox_diagnostic(
                "path-resolution",
                format!("Failed to resolve cwd {}: {e}", request.cwd.display()),
                "Use an existing cwd inside the private thread workspace or a configured Computer Agent allowed root.",
            )
        })?;
        let allowed_roots = canonical_allowed_roots(&request, &workspace).map_err(|e| {
            sandbox_diagnostic(
                "allowed-root-resolution",
                e,
                "Remove missing, unsafe, or inaccessible Computer Agent allowed roots from settings and retry.",
            )
        })?;

        if !allowed_roots
            .iter()
            .any(|root| super::path_starts_with(&cwd, root))
        {
            return Err(sandbox_diagnostic(
                "path-validation",
                "Runner cwd must stay inside the canonical workspace or a canonical allowed root",
                "Use a cwd inside the private thread workspace or a configured Computer Agent allowed root.",
            ));
        }

        for root in &allowed_roots {
            reject_symlinks(root).map_err(|e| {
                sandbox_diagnostic(
                    "symlink-scan",
                    e,
                    "Remove symlinks from Computer Agent shell roots before retrying.",
                )
            })?;
        }

        let run_tmp = prepare_run_tmp(&workspace).map_err(|e| {
            sandbox_diagnostic(
                "workspace-temp",
                e,
                "Confirm the private thread workspace is writable so the runner can create an isolated temporary directory.",
            )
        })?;
        let profile = seatbelt_profile(&allowed_roots, &run_tmp);
        let output = run_seatbelt_command(&request, &cwd, &workspace, &run_tmp, &profile)?;

        Ok(completed_response(
            "macOS sandbox completed",
            output.exit_code,
            output.stdout,
            output.stderr,
            output.timed_out,
        ))
    }

    struct ProcessOutput {
        exit_code: Option<i32>,
        stdout: String,
        stderr: String,
        timed_out: bool,
    }

    fn run_seatbelt_command(
        request: &RunnerRequest,
        cwd: &Path,
        workspace: &Path,
        run_tmp: &Path,
        profile: &str,
    ) -> Result<ProcessOutput, String> {
        let mut command = Command::new("/usr/bin/sandbox-exec");
        command
            .arg("-p")
            .arg(profile)
            .arg("/bin/sh")
            .arg("-lc")
            .arg(&request.command)
            .current_dir(cwd)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env_clear()
            .env(
                "PATH",
                "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
            )
            .env("HOME", workspace)
            .env("TMPDIR", run_tmp)
            .env("TEMP", run_tmp)
            .env("TMP", run_tmp)
            .env("SHELL", "/bin/sh")
            .env("LANG", "C.UTF-8")
            .env("LC_ALL", "C.UTF-8");

        unsafe {
            command.pre_exec(|| {
                if libc::setpgid(0, 0) == 0 {
                    Ok(())
                } else {
                    Err(std::io::Error::last_os_error())
                }
            });
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("Failed to start macOS Computer Agent runner: {e}"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture runner stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "Failed to capture runner stderr".to_string())?;
        let stdout_cap = request.max_output_bytes;
        let stderr_cap = request.max_output_bytes;
        let stdout_thread = thread::spawn(move || read_limited(stdout, stdout_cap));
        let stderr_thread = thread::spawn(move || read_limited(stderr, stderr_cap));

        let deadline = Instant::now() + Duration::from_secs(request.timeout_seconds);
        let mut timed_out = false;
        let status = loop {
            if let Some(status) = child
                .try_wait()
                .map_err(|e| format!("Failed while waiting for macOS sandbox: {e}"))?
            {
                break status;
            }

            if Instant::now() >= deadline {
                timed_out = true;
                kill_process_group(child.id());
                break child
                    .wait()
                    .map_err(|e| format!("Failed while killing timed-out macOS sandbox: {e}"))?;
            }

            thread::sleep(Duration::from_millis(25));
        };

        let stdout = stdout_thread
            .join()
            .map_err(|_| "Failed to join runner stdout reader".to_string())??;
        let stderr = stderr_thread
            .join()
            .map_err(|_| "Failed to join runner stderr reader".to_string())??;

        Ok(ProcessOutput {
            exit_code: status
                .code()
                .or_else(|| status.signal().map(|signal| -signal)),
            stdout,
            stderr,
            timed_out,
        })
    }

    fn read_limited<R: Read>(mut reader: R, cap: usize) -> Result<String, String> {
        let mut collected = Vec::with_capacity(cap.min(8192));
        let mut truncated = false;
        let mut chunk = [0u8; 8192];

        loop {
            let n = reader
                .read(&mut chunk)
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

    fn kill_process_group(pid: u32) {
        unsafe {
            let pgid = -(pid as libc::pid_t);
            let _ = libc::kill(pgid, libc::SIGKILL);
        }
    }

    fn canonical_allowed_roots(
        request: &RunnerRequest,
        workspace: &Path,
    ) -> Result<Vec<PathBuf>, String> {
        let mut roots = Vec::new();
        push_canonical_root(&mut roots, workspace.to_path_buf())?;

        for root in &request.allowed_roots {
            let canonical = canonical_directory(root)?;
            push_canonical_root(&mut roots, canonical)?;
        }

        Ok(roots)
    }

    fn push_canonical_root(roots: &mut Vec<PathBuf>, root: PathBuf) -> Result<(), String> {
        if !root.is_dir() {
            return Err(format!(
                "macOS Computer Agent shell root is not a directory: {}",
                root.display()
            ));
        }
        if root.parent().is_none() {
            return Err(format!(
                "macOS Computer Agent shell cannot use a filesystem root: {}",
                root.display()
            ));
        }
        if !roots.iter().any(|existing| {
            super::path_starts_with(existing, &root) && super::path_starts_with(&root, existing)
        }) {
            roots.push(root);
        }
        Ok(())
    }

    fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
        let canonical = path
            .canonicalize()
            .map_err(|e| format!("Failed to resolve {}: {e}", path.display()))?;
        if !canonical.is_dir() {
            return Err(format!("{} is not a directory", canonical.display()));
        }
        Ok(super::normalize_lexical(&canonical))
    }

    fn reject_symlinks(root: &Path) -> Result<(), String> {
        let mut stack = vec![root.to_path_buf()];
        let mut scanned = 0usize;

        while let Some(path) = stack.pop() {
            scanned += 1;
            if scanned > 50_000 {
                return Err(format!(
                    "Refusing to scan more than 50000 entries below {}",
                    root.display()
                ));
            }

            let metadata = fs::symlink_metadata(&path)
                .map_err(|e| format!("Failed to inspect {}: {e}", path.display()))?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "Symlink is not allowed inside macOS Computer Agent shell root: {}",
                    path.display()
                ));
            }
            if metadata.is_dir() {
                for entry in fs::read_dir(&path)
                    .map_err(|e| format!("Failed to scan {}: {e}", path.display()))?
                {
                    let entry =
                        entry.map_err(|e| format!("Failed to scan directory entry: {e}"))?;
                    stack.push(entry.path());
                }
            }
        }

        Ok(())
    }

    fn prepare_run_tmp(workspace: &Path) -> Result<PathBuf, String> {
        let base = workspace.join(TEMP_DIR_NAME);
        fs::create_dir_all(&base)
            .map_err(|e| format!("Failed to create {}: {e}", base.display()))?;
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_millis())
            .unwrap_or_default();
        let run_tmp = base.join(format!("run-{}-{stamp}", std::process::id()));
        fs::create_dir_all(&run_tmp)
            .map_err(|e| format!("Failed to create {}: {e}", run_tmp.display()))?;
        Ok(run_tmp)
    }

    fn seatbelt_profile(allowed_roots: &[PathBuf], run_tmp: &Path) -> String {
        let mut profile = String::from(
            "(version 1)\n\
             (deny default)\n\
             (allow process*)\n\
             (allow sysctl*)\n\
             (allow file-read*)\n\
             (allow file-write* (literal \"/dev/null\"))\n",
        );

        for root in allowed_roots {
            let path = escape_seatbelt_path(root);
            profile.push_str(&format!("(allow file-write* (subpath \"{path}\"))\n"));
        }
        let tmp = escape_seatbelt_path(run_tmp);
        profile.push_str(&format!("(allow file-write* (subpath \"{tmp}\"))\n"));

        profile
    }

    fn escape_seatbelt_path(path: &Path) -> String {
        path.to_string_lossy()
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
    }

    fn sandbox_diagnostic(stage: &str, reason: impl AsRef<str>, next_step: &str) -> String {
        let reason = reason.as_ref();
        if reason.starts_with(DIAGNOSTIC_PREFIX) {
            return reason.to_string();
        }

        format!(
            "{DIAGNOSTIC_PREFIX}\n\
Stage: {stage}\n\
Reason: {reason}\n\
Phase: {}\n\
Next step: {next_step}\n\
Telemetry: none; this diagnostic was generated locally.",
            super::RUNNER_PHASE
        )
    }
}

#[cfg(windows)]
mod native {
    use std::{
        ffi::{c_void, OsStr},
        fs,
        mem::size_of,
        os::windows::{ffi::OsStrExt, fs::MetadataExt},
        path::{Path, PathBuf},
        process::Command,
        ptr::{null, null_mut},
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };

    use windows_sys::{
        core::PWSTR,
        Win32::{
            Foundation::{
                CloseHandle, GetLastError, LocalFree, SetHandleInformation, FALSE, HANDLE,
                HANDLE_FLAG_INHERIT, HLOCAL, TRUE, WAIT_OBJECT_0, WAIT_TIMEOUT,
            },
            Security::{
                Authorization::ConvertSidToStringSidW,
                FreeSid,
                Isolation::{
                    CreateAppContainerProfile, DeleteAppContainerProfile,
                    DeriveAppContainerSidFromAppContainerName,
                },
                PSID, SECURITY_ATTRIBUTES, SECURITY_CAPABILITIES,
            },
            Storage::FileSystem::{ReadFile, FILE_ATTRIBUTE_REPARSE_POINT},
            System::{
                JobObjects::{
                    AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
                    SetInformationJobObject, TerminateJobObject,
                    JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                },
                Pipes::CreatePipe,
                Threading::{
                    CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
                    InitializeProcThreadAttributeList, ResumeThread, TerminateProcess,
                    UpdateProcThreadAttribute, WaitForSingleObject, CREATE_NO_WINDOW,
                    CREATE_SUSPENDED, EXTENDED_STARTUPINFO_PRESENT, LPPROC_THREAD_ATTRIBUTE_LIST,
                    PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
                    STARTF_USESTDHANDLES, STARTUPINFOEXW, STARTUPINFOW,
                },
            },
        },
    };

    use serde::{Deserialize, Serialize};

    use super::{
        completed_response, error_response, sandbox_diagnostic, RunnerRequest, RunnerResponse,
    };

    const HRESULT_ALREADY_EXISTS: i32 = 0x800700B7_u32 as i32;
    const WAIT_FAILED: u32 = 0xFFFF_FFFF;
    const CLEANUP_DIR_NAME: &str = ".mita-computer-agent-runner-cleanups";

    pub fn execute_sandboxed(request: RunnerRequest) -> RunnerResponse {
        match execute_sandboxed_inner(request) {
            Ok(response) => response,
            Err(error) => error_response(error),
        }
    }

    fn execute_sandboxed_inner(request: RunnerRequest) -> Result<RunnerResponse, String> {
        let workspace = request.workspace_root.canonicalize().map_err(|e| {
            sandbox_diagnostic(
                "path-resolution",
                format!(
                    "Failed to resolve workspace root {}: {e}",
                    request.workspace_root.display()
                ),
                "Confirm the thread workspace exists and is accessible, then retry the command.",
            )
        })?;
        let workspace_for_os = win32_path(&workspace);

        let cwd = request
            .cwd
            .canonicalize()
            .map_err(|e| {
                sandbox_diagnostic(
                    "path-resolution",
                    format!("Failed to resolve cwd {}: {e}", request.cwd.display()),
                    "Confirm the command cwd exists inside the thread workspace, then retry the command.",
                )
            })?;
        let cwd_for_os = win32_path(&cwd);
        let allowed_roots = canonical_allowed_roots(&request, &workspace).map_err(|e| {
            sandbox_diagnostic(
                "allowed-root-resolution",
                e,
                "Remove missing, unsafe, or inaccessible Computer Agent allowed roots from settings and retry.",
            )
        })?;

        if !allowed_roots
            .iter()
            .any(|root| super::path_starts_with(&cwd_for_os, root))
        {
            return Err(sandbox_diagnostic(
                "path-validation",
                "Runner cwd must stay inside the canonical workspace or a canonical allowed root",
                "Use a cwd inside the private thread workspace or a configured Computer Agent allowed root.",
            ));
        }

        for root in &allowed_roots {
            let is_workspace = super::path_starts_with(root, &workspace_for_os)
                && super::path_starts_with(&workspace_for_os, root);
            ensure_root_has_no_reparse_points(root).map_err(|e| {
                sandbox_diagnostic(
                    if is_workspace {
                        "workspace-reparse-scan"
                    } else {
                        "allowed-root-reparse-scan"
                    },
                    e,
                    if is_workspace {
                        "Remove junctions, symlinks, or other reparse points from the thread workspace before retrying."
                    } else {
                        "Remove junctions, symlinks, or other reparse points from the configured allowed root before retrying."
                    },
                )
            })?;
        }
        cleanup_stale_sandbox(&workspace_for_os).map_err(|e| {
            sandbox_diagnostic(
                "stale-sandbox-cleanup",
                e,
                "Close running Mita instances, verify workspace permissions, and retry so the runner can remove stale ACL/profile state.",
            )
        })?;

        let app_container = AppContainerProfile::create().map_err(|e| {
            sandbox_diagnostic(
                "app-container-profile",
                e,
                "Confirm Windows AppContainer APIs are available for this user and retry. A reboot can clear stuck per-user AppContainer state.",
            )
        })?;
        let _journal =
            SandboxCleanupJournal::write(&workspace_for_os, &allowed_roots, &app_container)
                .map_err(|e| {
                    sandbox_diagnostic(
                        "cleanup-journal",
                        e,
                        "Confirm the parent agent-workspaces directory is writable so the runner can record crash cleanup state.",
                    )
                })?;
        let _acl = RootAclGrants::grant(&allowed_roots, &app_container.sid_string).map_err(|e| {
            sandbox_diagnostic(
                "root-acl-grant",
                e,
                "Confirm each Computer Agent root is on a local NTFS drive and the current user can change its ACL.",
            )
        })?;
        let process_output =
            create_app_container_process(&request, &cwd_for_os, app_container.sid).map_err(|e| {
                sandbox_diagnostic(
                    "sandbox-process-launch",
                    e,
                    "Confirm cmd.exe and core Windows process/job-object APIs are available, then retry.",
                )
            })?;

        Ok(completed_response(
            "Windows sandbox completed",
            process_output.exit_code,
            process_output.stdout,
            process_output.stderr,
            process_output.timed_out,
        ))
    }

    fn canonical_allowed_roots(
        request: &RunnerRequest,
        workspace: &Path,
    ) -> Result<Vec<PathBuf>, String> {
        let mut roots = Vec::new();
        push_canonical_root(&mut roots, win32_path(workspace))?;

        for root in &request.allowed_roots {
            let canonical = root
                .canonicalize()
                .map_err(|e| format!("Failed to resolve allowed root {}: {e}", root.display()))?;
            push_canonical_root(&mut roots, win32_path(&canonical))?;
        }

        Ok(roots)
    }

    fn push_canonical_root(roots: &mut Vec<PathBuf>, root: PathBuf) -> Result<(), String> {
        if root.to_string_lossy().starts_with("\\\\") {
            return Err(format!(
                "Windows Computer Agent shell requires local drive roots; UNC path is not supported: {}",
                root.display()
            ));
        }
        if !root.is_dir() {
            return Err(format!(
                "Windows Computer Agent shell root is not a directory: {}",
                root.display()
            ));
        }
        if root.parent().is_none() {
            return Err(format!(
                "Windows Computer Agent shell cannot grant a filesystem root: {}",
                root.display()
            ));
        }
        if !roots.iter().any(|existing| {
            super::path_starts_with(existing, &root) && super::path_starts_with(&root, existing)
        }) {
            roots.push(root);
        }
        Ok(())
    }

    struct ProcessOutput {
        exit_code: Option<i32>,
        stdout: String,
        stderr: String,
        timed_out: bool,
    }

    fn create_app_container_process(
        request: &RunnerRequest,
        cwd: &Path,
        app_container_sid: PSID,
    ) -> Result<ProcessOutput, String> {
        let (mut stdout_read, stdout_write) = create_inheritable_pipe()?;
        let (mut stderr_read, stderr_write) = create_inheritable_pipe()?;
        let job = Job::new()?;

        let mut security_capabilities = SECURITY_CAPABILITIES {
            AppContainerSid: app_container_sid,
            Capabilities: null_mut(),
            CapabilityCount: 0,
            Reserved: 0,
        };
        let mut attribute_list = AttributeList::new(&mut security_capabilities)?;

        let cmd_exe = system_cmd_exe();
        let mut application_name = wide_null(&cmd_exe.as_os_str());
        let mut command_line = wide_null(OsStr::new(&format!(
            "\"{}\" /D /S /C {}",
            cmd_exe.display(),
            request.command
        )));
        let cwd_wide = wide_null(cwd.as_os_str());

        let mut startup = STARTUPINFOEXW::default();
        startup.StartupInfo.cb = size_of::<STARTUPINFOEXW>() as u32;
        startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
        startup.StartupInfo.hStdInput = null_mut();
        startup.StartupInfo.hStdOutput = stdout_write.raw();
        startup.StartupInfo.hStdError = stderr_write.raw();
        startup.lpAttributeList = attribute_list.as_mut_ptr();

        let mut process_info = PROCESS_INFORMATION::default();
        let created = unsafe {
            CreateProcessW(
                application_name.as_mut_ptr(),
                command_line.as_mut_ptr(),
                null(),
                null(),
                TRUE,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW,
                null(),
                cwd_wide.as_ptr(),
                &startup as *const STARTUPINFOEXW as *const STARTUPINFOW,
                &mut process_info,
            )
        };
        if created == FALSE {
            return Err(last_error("CreateProcessW failed"));
        }

        let process = Handle::new(process_info.hProcess);
        let thread_handle = Handle::new(process_info.hThread);
        drop(stdout_write);
        drop(stderr_write);

        if unsafe { AssignProcessToJobObject(job.raw(), process.raw()) } == FALSE {
            unsafe {
                TerminateProcess(process.raw(), 1);
            }
            return Err(last_error("AssignProcessToJobObject failed"));
        }

        if unsafe { ResumeThread(thread_handle.raw()) } == u32::MAX {
            unsafe {
                TerminateJobObject(job.raw(), 1);
            }
            return Err(last_error("ResumeThread failed"));
        }

        let stdout_handle = stdout_read.take() as isize;
        let stderr_handle = stderr_read.take() as isize;
        let stdout_cap = request.max_output_bytes;
        let stderr_cap = request.max_output_bytes;
        let stdout_task =
            thread::spawn(move || read_pipe_limited(stdout_handle as HANDLE, stdout_cap));
        let stderr_task =
            thread::spawn(move || read_pipe_limited(stderr_handle as HANDLE, stderr_cap));

        let timeout_ms = request
            .timeout_seconds
            .saturating_mul(1000)
            .min(u32::MAX as u64) as u32;
        let wait = unsafe { WaitForSingleObject(process.raw(), timeout_ms) };
        let timed_out = wait == WAIT_TIMEOUT;
        if timed_out {
            unsafe {
                TerminateJobObject(job.raw(), 124);
                WaitForSingleObject(process.raw(), 5000);
            }
        } else if wait != WAIT_OBJECT_0 {
            unsafe {
                TerminateJobObject(job.raw(), 1);
            }
            return Err(if wait == WAIT_FAILED {
                last_error("WaitForSingleObject failed")
            } else {
                format!("WaitForSingleObject returned unexpected status {wait}")
            });
        }

        let mut exit_code = 0u32;
        let exit_code = if unsafe { GetExitCodeProcess(process.raw(), &mut exit_code) } != FALSE {
            Some(exit_code as i32)
        } else {
            None
        };

        let stdout = stdout_task
            .join()
            .map_err(|_| "stdout reader thread panicked".to_string())??;
        let stderr = stderr_task
            .join()
            .map_err(|_| "stderr reader thread panicked".to_string())??;

        Ok(ProcessOutput {
            exit_code,
            stdout,
            stderr,
            timed_out,
        })
    }

    struct AppContainerProfile {
        name: String,
        sid: PSID,
        sid_string: String,
    }

    impl AppContainerProfile {
        fn create() -> Result<Self, String> {
            let name = format!(
                "mita-computer-agent-runner-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_millis()
            );
            let name_wide = wide_null(OsStr::new(&name));
            let display = wide_null(OsStr::new("Mita Computer Runner"));
            let description = wide_null(OsStr::new("Experimental Mita Computer Agent sandbox"));
            let mut sid: PSID = null_mut();

            let hr = unsafe {
                CreateAppContainerProfile(
                    name_wide.as_ptr(),
                    display.as_ptr(),
                    description.as_ptr(),
                    null(),
                    0,
                    &mut sid,
                )
            };

            if failed_hresult(hr) && hr != HRESULT_ALREADY_EXISTS {
                return Err(format!(
                    "CreateAppContainerProfile failed with HRESULT 0x{:08X}",
                    hr as u32
                ));
            }

            if hr == HRESULT_ALREADY_EXISTS {
                let derived = unsafe {
                    DeriveAppContainerSidFromAppContainerName(name_wide.as_ptr(), &mut sid)
                };
                if failed_hresult(derived) {
                    return Err(format!(
                        "DeriveAppContainerSidFromAppContainerName failed with HRESULT 0x{:08X}",
                        derived as u32
                    ));
                }
            }

            let sid_string = sid_to_string(sid)?;
            Ok(Self {
                name,
                sid,
                sid_string,
            })
        }
    }

    impl Drop for AppContainerProfile {
        fn drop(&mut self) {
            delete_app_container_profile(&self.name);
            unsafe {
                if !self.sid.is_null() {
                    FreeSid(self.sid);
                }
            }
        }
    }

    struct RootAclGrants {
        _grants: Vec<RootAclGrant>,
    }

    impl RootAclGrants {
        fn grant(roots: &[PathBuf], sid_string: &str) -> Result<Self, String> {
            let mut grants = Vec::new();
            for root in roots {
                grants.push(RootAclGrant::grant(root, sid_string)?);
            }
            Ok(Self { _grants: grants })
        }
    }

    struct RootAclGrant {
        root: PathBuf,
        sid_string: String,
    }

    impl RootAclGrant {
        fn grant(root: &Path, sid_string: &str) -> Result<Self, String> {
            run_icacls(
                root,
                &["/grant", &format!("*{sid_string}:(OI)(CI)(M)"), "/T", "/C"],
                "grant Computer Agent root ACL",
            )?;
            Ok(Self {
                root: root.to_path_buf(),
                sid_string: sid_string.to_string(),
            })
        }
    }

    impl Drop for RootAclGrant {
        fn drop(&mut self) {
            let _ = run_icacls(
                &self.root,
                &["/remove", &format!("*{}", self.sid_string), "/T", "/C"],
                "remove Computer Agent root ACL",
            );
        }
    }

    #[derive(Debug, Serialize, Deserialize)]
    struct SandboxCleanupRecord {
        profile_name: String,
        sid_string: String,
        workspace: String,
        #[serde(default)]
        roots: Vec<String>,
    }

    struct SandboxCleanupJournal {
        path: PathBuf,
    }

    impl SandboxCleanupJournal {
        fn write(
            workspace: &Path,
            roots: &[PathBuf],
            app_container: &AppContainerProfile,
        ) -> Result<Self, String> {
            let path = cleanup_journal_path(workspace);
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| {
                    format!(
                        "Failed to create Windows runner cleanup journal directory {}: {e}",
                        parent.display()
                    )
                })?;
            }

            let record = SandboxCleanupRecord {
                profile_name: app_container.name.clone(),
                sid_string: app_container.sid_string.clone(),
                workspace: workspace.to_string_lossy().to_string(),
                roots: roots
                    .iter()
                    .map(|root| root.to_string_lossy().to_string())
                    .collect(),
            };
            let json = serde_json::to_string(&record)
                .map_err(|e| format!("Failed to serialize cleanup journal: {e}"))?;
            fs::write(&path, json).map_err(|e| {
                format!(
                    "Failed to write Windows runner cleanup journal {}: {e}",
                    path.display()
                )
            })?;

            Ok(Self { path })
        }
    }

    impl Drop for SandboxCleanupJournal {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.path);
        }
    }

    fn cleanup_stale_sandbox(workspace: &Path) -> Result<(), String> {
        let path = cleanup_journal_path(workspace);
        if !path.is_file() {
            return Ok(());
        }

        let json = fs::read_to_string(&path).map_err(|e| {
            format!(
                "Failed to read stale Windows runner cleanup journal {}: {e}",
                path.display()
            )
        })?;
        let record: SandboxCleanupRecord = serde_json::from_str(&json).map_err(|e| {
            format!(
                "Failed to parse stale Windows runner cleanup journal {}: {e}",
                path.display()
            )
        })?;
        validate_cleanup_record(&record, workspace)?;

        for root in cleanup_record_roots(&record, workspace) {
            let _ = run_icacls(
                &root,
                &["/remove", &format!("*{}", record.sid_string), "/T", "/C"],
                "remove stale Computer Agent root ACL",
            );
        }
        delete_app_container_profile(&record.profile_name);
        fs::remove_file(&path).map_err(|e| {
            format!(
                "Failed to remove stale Windows runner cleanup journal {}: {e}",
                path.display()
            )
        })?;

        Ok(())
    }

    fn validate_cleanup_record(
        record: &SandboxCleanupRecord,
        workspace: &Path,
    ) -> Result<(), String> {
        if !record
            .profile_name
            .starts_with("mita-computer-agent-runner-")
            || record.profile_name.chars().any(char::is_control)
        {
            return Err(
                "Stale Windows runner cleanup journal has an invalid profile name".to_string(),
            );
        }
        if !record.sid_string.starts_with("S-1-15-2-")
            || record.sid_string.chars().any(char::is_control)
        {
            return Err(
                "Stale Windows runner cleanup journal has an invalid AppContainer SID".to_string(),
            );
        }
        if record.workspace != workspace.to_string_lossy() {
            return Err(
                "Stale Windows runner cleanup journal does not match the workspace".to_string(),
            );
        }
        for root in cleanup_record_roots(record, workspace) {
            let root_text = root.to_string_lossy();
            if root_text.chars().any(char::is_control) {
                return Err("Stale Windows runner cleanup journal has an invalid root".to_string());
            }
            if root.parent().is_none() {
                return Err(
                    "Stale Windows runner cleanup journal contains a filesystem root".to_string(),
                );
            }
        }
        Ok(())
    }

    fn cleanup_record_roots(record: &SandboxCleanupRecord, workspace: &Path) -> Vec<PathBuf> {
        if record.roots.is_empty() {
            vec![workspace.to_path_buf()]
        } else {
            record.roots.iter().map(PathBuf::from).collect()
        }
    }

    fn delete_app_container_profile(name: &str) {
        let name = wide_null(OsStr::new(name));
        unsafe {
            DeleteAppContainerProfile(name.as_ptr());
        }
    }

    fn cleanup_journal_path(workspace: &Path) -> PathBuf {
        let cleanup_dir = workspace
            .parent()
            .map(|parent| parent.join(CLEANUP_DIR_NAME))
            .unwrap_or_else(|| workspace.join(CLEANUP_DIR_NAME));
        cleanup_dir.join(format!("{:016x}.json", stable_workspace_hash(workspace)))
    }

    fn stable_workspace_hash(workspace: &Path) -> u64 {
        let text = workspace.to_string_lossy().to_ascii_lowercase();
        let mut hash = 0xcbf29ce484222325u64;
        for byte in text.as_bytes() {
            hash ^= u64::from(*byte);
            hash = hash.wrapping_mul(0x100000001b3);
        }
        hash
    }

    #[cfg(test)]
    pub(super) fn cleanup_journal_path_for_test(workspace: &Path) -> PathBuf {
        cleanup_journal_path(&win32_path(workspace))
    }

    struct Job {
        handle: Handle,
    }

    impl Job {
        fn new() -> Result<Self, String> {
            let handle = unsafe { CreateJobObjectW(null(), null()) };
            let handle = Handle::new(handle);
            if handle.is_invalid() {
                return Err(last_error("CreateJobObjectW failed"));
            }

            let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            let ok = unsafe {
                SetInformationJobObject(
                    handle.raw(),
                    JobObjectExtendedLimitInformation,
                    &info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION as *const c_void,
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if ok == FALSE {
                return Err(last_error("SetInformationJobObject failed"));
            }

            Ok(Self { handle })
        }

        fn raw(&self) -> HANDLE {
            self.handle.raw()
        }
    }

    struct AttributeList {
        storage: Vec<u8>,
        ptr: LPPROC_THREAD_ATTRIBUTE_LIST,
    }

    impl AttributeList {
        fn new(security_capabilities: &mut SECURITY_CAPABILITIES) -> Result<Self, String> {
            let mut size = 0usize;
            unsafe {
                InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size);
            }
            if size == 0 {
                return Err(last_error(
                    "InitializeProcThreadAttributeList sizing failed",
                ));
            }

            let mut storage = vec![0u8; size];
            let ptr = storage.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
            if unsafe { InitializeProcThreadAttributeList(ptr, 1, 0, &mut size) } == FALSE {
                return Err(last_error("InitializeProcThreadAttributeList failed"));
            }

            let updated = unsafe {
                UpdateProcThreadAttribute(
                    ptr,
                    0,
                    PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
                    security_capabilities as *mut SECURITY_CAPABILITIES as *const c_void,
                    size_of::<SECURITY_CAPABILITIES>(),
                    null_mut(),
                    null(),
                )
            };
            if updated == FALSE {
                unsafe {
                    DeleteProcThreadAttributeList(ptr);
                }
                return Err(last_error("UpdateProcThreadAttribute failed"));
            }

            Ok(Self { storage, ptr })
        }

        fn as_mut_ptr(&mut self) -> LPPROC_THREAD_ATTRIBUTE_LIST {
            let _ = self.storage.len();
            self.ptr
        }
    }

    impl Drop for AttributeList {
        fn drop(&mut self) {
            unsafe {
                DeleteProcThreadAttributeList(self.ptr);
            }
        }
    }

    struct Handle(HANDLE);

    impl Handle {
        fn new(handle: HANDLE) -> Self {
            Self(handle)
        }

        fn raw(&self) -> HANDLE {
            self.0
        }

        fn take(&mut self) -> HANDLE {
            let handle = self.0;
            self.0 = null_mut();
            handle
        }

        fn is_invalid(&self) -> bool {
            self.0.is_null()
        }
    }

    impl Drop for Handle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                unsafe {
                    CloseHandle(self.0);
                }
                self.0 = null_mut();
            }
        }
    }

    fn create_inheritable_pipe() -> Result<(Handle, Handle), String> {
        let mut read_pipe: HANDLE = null_mut();
        let mut write_pipe: HANDLE = null_mut();
        let security_attributes = SECURITY_ATTRIBUTES {
            nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: null_mut(),
            bInheritHandle: TRUE,
        };

        if unsafe { CreatePipe(&mut read_pipe, &mut write_pipe, &security_attributes, 0) } == FALSE
        {
            return Err(last_error("CreatePipe failed"));
        }

        let read = Handle::new(read_pipe);
        let write = Handle::new(write_pipe);
        if unsafe { SetHandleInformation(read.raw(), HANDLE_FLAG_INHERIT, 0) } == FALSE {
            return Err(last_error("SetHandleInformation failed"));
        }

        Ok((read, write))
    }

    fn read_pipe_limited(handle: HANDLE, cap: usize) -> Result<String, String> {
        let _handle = Handle::new(handle);
        let mut collected = Vec::with_capacity(cap.min(8192));
        let mut truncated = false;
        let mut buffer = [0u8; 8192];

        loop {
            let mut bytes_read = 0u32;
            let ok = unsafe {
                ReadFile(
                    handle,
                    buffer.as_mut_ptr(),
                    buffer.len() as u32,
                    &mut bytes_read,
                    null_mut(),
                )
            };

            if ok == FALSE || bytes_read == 0 {
                break;
            }

            let bytes_read = bytes_read as usize;
            let remaining = cap.saturating_sub(collected.len());
            if remaining > 0 {
                let to_copy = remaining.min(bytes_read);
                collected.extend_from_slice(&buffer[..to_copy]);
            }
            if bytes_read > remaining {
                truncated = true;
            }
        }

        let mut text = String::from_utf8_lossy(&collected).to_string();
        if truncated {
            text.push_str("\n[output truncated]");
        }
        Ok(text)
    }

    fn sid_to_string(sid: PSID) -> Result<String, String> {
        let mut sid_string: PWSTR = null_mut();
        if unsafe { ConvertSidToStringSidW(sid, &mut sid_string) } == FALSE {
            return Err(last_error("ConvertSidToStringSidW failed"));
        }

        let mut len = 0usize;
        unsafe {
            while *sid_string.add(len) != 0 {
                len += 1;
            }
        }
        let text = unsafe { std::slice::from_raw_parts(sid_string, len) };
        let text = String::from_utf16_lossy(text);
        unsafe {
            LocalFree(sid_string as HLOCAL);
        }
        Ok(text)
    }

    fn run_icacls(workspace: &Path, args: &[&str], action: &str) -> Result<(), String> {
        use std::os::windows::process::CommandExt;

        let output = Command::new("icacls")
            .arg(workspace)
            .args(args)
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("Failed to run icacls to {action}: {e}"))?;

        if output.status.success() {
            Ok(())
        } else {
            Err(format!(
                "icacls failed to {action}: {}",
                String::from_utf8_lossy(&output.stderr)
            ))
        }
    }

    fn ensure_root_has_no_reparse_points(path: &Path) -> Result<(), String> {
        let metadata = std::fs::symlink_metadata(path)
            .map_err(|e| format!("Failed to inspect sandbox root {}: {e}", path.display()))?;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return Err(format!(
                "Sandbox root contains unsupported reparse point: {}",
                path.display()
            ));
        }

        if metadata.is_dir() {
            for entry in std::fs::read_dir(path)
                .map_err(|e| format!("Failed to scan sandbox root {}: {e}", path.display()))?
            {
                let entry = entry
                    .map_err(|e| format!("Failed to scan sandbox root {}: {e}", path.display()))?;
                ensure_root_has_no_reparse_points(&entry.path())?;
            }
        }

        Ok(())
    }

    fn system_cmd_exe() -> PathBuf {
        let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
        PathBuf::from(system_root).join("System32").join("cmd.exe")
    }

    fn win32_path(path: &Path) -> PathBuf {
        let text = path.as_os_str().to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            PathBuf::from(format!(r"\\{rest}"))
        } else if let Some(rest) = text.strip_prefix(r"\\?\") {
            PathBuf::from(rest)
        } else {
            path.to_path_buf()
        }
    }

    fn wide_null(value: &OsStr) -> Vec<u16> {
        value.encode_wide().chain(std::iter::once(0)).collect()
    }

    fn failed_hresult(hr: i32) -> bool {
        hr < 0
    }

    fn last_error(context: &str) -> String {
        let error = unsafe { GetLastError() };
        format!("{context}: Windows error {error}")
    }
}
