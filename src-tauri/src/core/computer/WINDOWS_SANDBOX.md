# Windows Computer Use Sandbox Route

This document tracks the Windows implementation route for `computer_run_shell`.
The shell tool must stay unavailable on Windows until the native runner can
enforce the same minimum safety boundary as the Linux and macOS runners.

## Target Boundary

The Windows runner must enforce all of these properties before Mita exposes
`computer_run_shell` to normal users:

- The command runs in a separate `mita-computer-runner.exe` process.
- The Tauri app remains the broker for settings, approvals, path validation,
  and output collection.
- The first usable phase only writes inside the current thread workspace.
- Custom allowed roots stay disabled until ACL handling is implemented.
- The process tree is attached to a Job Object and is killed on timeout.
- The command is non-interactive and receives no stdin.
- stdout and stderr are capped independently.
- Network access is blocked.
- Registry, COM, WMI, and broad user-profile access are not assumed safe.
- Reparse points and symlinks are treated as escape risks.

## Phases

### Phase 0: protocol and gating

Status: complete.

- Add an explicit runner protocol and status surface.
- Keep `computer_run_shell` unavailable on Windows.
- Add a runner binary scaffold that refuses execution.
- Make the settings UI show the runner phase and blockers.

Exit criteria:

- The main app can report why Windows shell is unavailable.
- A future runner can be swapped behind the protocol without changing chat
  tool routing or approval logic.

### Phase 1: local workspace-only prototype

Status: complete behind the developer gate.

- Create an AppContainer profile per command or per thread.
- Grant the AppContainer SID access only to the thread workspace.
- Start the requested shell inside the AppContainer.
- Attach the child process to a Job Object.
- Kill the full Job Object on timeout.
- Capture capped stdout and stderr.
- Keep the feature behind a developer/experimental switch.

Current implementation:

- `mita-computer-runner.exe` validates the runner request and refuses by
  default.
- Setting `MITA_EXPERIMENTAL_WINDOWS_COMPUTER_RUNNER_EXECUTE=1` enables the
  direct runner prototype.
- Setting `MITA_EXPERIMENTAL_WINDOWS_COMPUTER_RUNNER=1` lets the Mita app expose
  `computer_run_shell` when the runner binary is discoverable and the user has
  enabled Computer Use shell in settings. The app injects
  `MITA_EXPERIMENTAL_WINDOWS_COMPUTER_RUNNER_EXECUTE=1` only into the runner
  child process.
- The prototype creates a per-command AppContainer profile.
- It grants the AppContainer SID temporary modify access to the thread
  workspace with `icacls`.
- It keeps canonical paths for validation, but passes normal Win32 drive paths
  to `cmd.exe` and `icacls`; UNC workspaces are refused in this phase.
- It starts `cmd.exe /D /S /C <command>` using
  `PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES`.
- It creates the process suspended, attaches it to a Job Object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, then resumes it.
- It captures capped stdout/stderr through inherited pipes.
- It removes the temporary workspace ACL grant and deletes the AppContainer
  profile when the run exits.

The Mita app reports Windows shell as available only with the explicit
`MITA_EXPERIMENTAL_WINDOWS_COMPUTER_RUNNER=1` developer gate. Without that gate,
the structured Computer Use tools still work and the shell stays hidden.

Exit criteria:

- The runner can write inside the workspace.
- Attempts to write outside the workspace fail in automated tests.
- Child processes are killed with the parent command.
- The command has no network access in automated tests.

### Phase 1.5: safety regression and packaged usability

Status: complete.

Implemented and verified:

- The Windows runner is built as part of the Windows Tauri build and packaged
  under `resources/computer-runner/mita-computer-runner.exe`.
- Runner discovery covers development, sidecar, and packaged resource paths.
- Installed app smoke testing confirmed the full chat path:
  tool discovery -> one-time approval UI -> `computer_run_shell` ->
  packaged runner -> thread workspace file output.
- The approval UI shows the exact command, cwd, and affected paths, and
  Computer Use tools cannot use global "allow all" or thread remembered
  permissions.
- `computer_run_shell` now creates the private thread workspace before
  validating a relative cwd. The installed smoke test found this as a real
  regression: `cwd: "."` used to fail before the workspace existed.
- Security regressions cover outside-workspace writes, output truncation,
  timeout process-tree cleanup, loopback network blocking, and junction escape
  attempts.

Validation run on 2026-05-11:

- `cargo test --manifest-path src-tauri/Cargo.toml computer --lib -- --nocapture`
  passed with 14 tests and 7 Windows runner tests ignored.
- `cargo test --manifest-path src-tauri/Cargo.toml computer --lib -- --ignored --nocapture --test-threads=1`
  passed the 7 Windows runner tests.
- `yarn build:tauri:win32` produced the NSIS and MSI installers.
- Installed NSIS smoke testing with
  `MITA_EXPERIMENTAL_WINDOWS_COMPUTER_RUNNER=1` confirmed that
  `smoke.txt` was written inside
  `%APPDATA%/Mita/data/agent-workspaces/<threadId>/`.

Known packaging issue:

- The MSI currently requests an all-users install and fails without elevation
  with Windows Installer error 1925. The NSIS installer can still be used for
  the packaged smoke path.

### Phase 2: hardening

- Script the installed-app smoke test so runner discovery, workspace-only shell,
  and approval UI regressions can be repeated without manual Playwright setup.
- Fix the MSI per-user/all-users install policy so non-admin smoke testing can
  cover both installer formats.
- Add reparse point and symlink escape tests.
- Add PowerShell, cmd, Node, Python, and Git Bash process-tree tests.
- Add explicit registry and user-profile access tests.
- Add crash cleanup for temporary AppContainer profiles and ACL changes.
- Add telemetry-free diagnostics for failed sandbox initialization.

Exit criteria:

- Security tests fail closed.
- The shell tool remains hidden if any required Windows primitive is missing.

### Phase 3: allowed roots

- Add temporary ACL grants for configured allowed roots.
- Refuse roots that cannot be canonicalized or safely ACL-managed.
- Roll back ACL grants after command completion.
- Keep custom roots opt-in and visible in the approval dialog.

Exit criteria:

- Allowed roots behave like the existing structured tools.
- ACL cleanup is verified after success, failure, and timeout.

## Non-goals

- Do not run shell commands in the main Tauri process.
- Do not rely on `cwd` as a security boundary.
- Do not expose Windows shell because a runner binary exists.
- Do not support permanent deletion through shell-specific shortcuts.
- Do not open the shell tool to the local OpenAI-compatible API in v1.
