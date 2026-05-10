use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const RUNNER_PROTOCOL_VERSION: u32 = 1;
pub const RUNNER_BINARY_NAME: &str = if cfg!(windows) {
    "mita-computer-runner.exe"
} else {
    "mita-computer-runner"
};
pub const RUNNER_PATH_ENV: &str = "MITA_WINDOWS_COMPUTER_RUNNER";
pub const RUNNER_ENABLE_ENV: &str = "MITA_EXPERIMENTAL_WINDOWS_COMPUTER_RUNNER";
pub const RUNNER_EXECUTE_ENV: &str = "MITA_EXPERIMENTAL_WINDOWS_COMPUTER_RUNNER_EXECUTE";
pub const RUNNER_PHASE: &str = "phase-1-workspace-prototype";

const BLOCKERS: &[&str] = &[
    "runner remains behind an explicit experimental execution gate",
    "network isolation still needs automated regression tests",
    "reparse point escape tests are not implemented",
    "PowerShell/cmd/child-process matrix tests are not implemented",
    "custom allowed roots are intentionally disabled",
];

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowsRunnerStatus {
    pub available: bool,
    pub phase: String,
    pub runner_path: Option<PathBuf>,
    pub reason: String,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RunnerRequest {
    pub protocol_version: u32,
    pub command: String,
    pub cwd: PathBuf,
    pub workspace_root: PathBuf,
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

pub fn windows_runner_status() -> WindowsRunnerStatus {
    let runner_path = discover_runner_binary();
    let mut blockers = Vec::new();

    let enabled = std::env::var(RUNNER_ENABLE_ENV).as_deref() == Ok("1");
    if !enabled {
        blockers.push(format!("{RUNNER_ENABLE_ENV}=1 is not set"));
    }

    if runner_path.is_none() {
        blockers.push(format!(
            "{RUNNER_BINARY_NAME} was not found next to the app or in {RUNNER_PATH_ENV}"
        ));
    }

    blockers.extend(BLOCKERS.iter().map(|blocker| blocker.to_string()));

    let available = enabled && runner_path.is_some();
    WindowsRunnerStatus {
        available,
        phase: RUNNER_PHASE.to_string(),
        runner_path,
        reason: if available {
            "Windows Computer Use shell runner is enabled as a phase-1 workspace-only prototype."
                .to_string()
        } else {
            "Windows Computer Use shell runner is not enabled for chats.".to_string()
        },
        blockers,
    }
}

pub fn preflight_response() -> RunnerResponse {
    RunnerResponse {
        protocol_version: RUNNER_PROTOCOL_VERSION,
        status: RunnerResponseStatus::Ready,
        message: format!("Windows runner protocol {RUNNER_PROTOCOL_VERSION} is available"),
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
            "{RUNNER_EXECUTE_ENV}=1 is required to run the experimental Windows sandbox prototype"
        ));
    }

    #[cfg(windows)]
    {
        native::execute_workspace_only(request)
    }

    #[cfg(not(windows))]
    {
        let _ = request;
        refused_response("The Windows Computer Use runner only executes on Windows.")
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
    let cwd = normalize_lexical(&request.cwd);
    if !path_starts_with(&cwd, &workspace) {
        return Err("Runner cwd must stay inside the thread workspace".to_string());
    }

    Ok(())
}

pub fn discover_runner_binary() -> Option<PathBuf> {
    if let Some(path) = std::env::var_os(RUNNER_PATH_ENV).map(PathBuf::from) {
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
                .join("computer-runner")
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
                    .join("computer-runner")
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
                .join("computer-runner")
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

#[cfg(windows)]
mod native {
    use std::{
        ffi::{c_void, OsStr},
        mem::size_of,
        os::windows::ffi::OsStrExt,
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
            Storage::FileSystem::ReadFile,
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

    use super::{completed_response, error_response, RunnerRequest, RunnerResponse};

    const HRESULT_ALREADY_EXISTS: i32 = 0x800700B7_u32 as i32;
    const WAIT_FAILED: u32 = 0xFFFF_FFFF;

    pub fn execute_workspace_only(request: RunnerRequest) -> RunnerResponse {
        match execute_workspace_only_inner(request) {
            Ok(response) => response,
            Err(error) => error_response(error),
        }
    }

    fn execute_workspace_only_inner(request: RunnerRequest) -> Result<RunnerResponse, String> {
        let workspace = request
            .workspace_root
            .canonicalize()
            .map_err(|e| format!("Failed to resolve workspace root: {e}"))?;
        let cwd = request
            .cwd
            .canonicalize()
            .map_err(|e| format!("Failed to resolve cwd: {e}"))?;

        if !super::path_starts_with(&cwd, &workspace) {
            return Err("Runner cwd must stay inside the canonical workspace".to_string());
        }

        let workspace_for_os = win32_path(&workspace);
        let cwd_for_os = win32_path(&cwd);
        if workspace_for_os.to_string_lossy().starts_with("\\\\") {
            return Err(
                "Phase 1 Windows runner requires a local drive workspace; UNC paths are not supported"
                    .to_string(),
            );
        }

        let app_container = AppContainerProfile::create()?;
        let _acl = WorkspaceAclGrant::grant(&workspace_for_os, &app_container.sid_string)?;
        let process_output =
            create_app_container_process(&request, &cwd_for_os, app_container.sid)?;

        Ok(completed_response(
            "Windows sandbox prototype completed",
            process_output.exit_code,
            process_output.stdout,
            process_output.stderr,
            process_output.timed_out,
        ))
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
                "mita-computer-runner-{}-{}",
                std::process::id(),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_err(|e| e.to_string())?
                    .as_millis()
            );
            let name_wide = wide_null(OsStr::new(&name));
            let display = wide_null(OsStr::new("Mita Computer Runner"));
            let description = wide_null(OsStr::new("Experimental Mita Computer Use sandbox"));
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
            let name = wide_null(OsStr::new(&self.name));
            unsafe {
                DeleteAppContainerProfile(name.as_ptr());
                if !self.sid.is_null() {
                    FreeSid(self.sid);
                }
            }
        }
    }

    struct WorkspaceAclGrant {
        workspace: PathBuf,
        sid_string: String,
    }

    impl WorkspaceAclGrant {
        fn grant(workspace: &Path, sid_string: &str) -> Result<Self, String> {
            run_icacls(
                workspace,
                &["/grant", &format!("*{sid_string}:(OI)(CI)(M)"), "/T", "/C"],
                "grant workspace ACL",
            )?;
            Ok(Self {
                workspace: workspace.to_path_buf(),
                sid_string: sid_string.to_string(),
            })
        }
    }

    impl Drop for WorkspaceAclGrant {
        fn drop(&mut self) {
            let _ = run_icacls(
                &self.workspace,
                &["/remove", &format!("*{}", self.sid_string), "/T", "/C"],
                "remove workspace ACL",
            );
        }
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
