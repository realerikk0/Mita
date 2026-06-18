# Windows Computer Agent Sandbox Route

This document tracks the Windows implementation route for `computer_agent_run_shell`.
The shell tool must stay unavailable on Windows until the native runner can
enforce the same minimum safety boundary as the Linux and macOS runners.

## Target Boundary

The Windows runner must enforce all of these properties before Biyan exposes
`computer_agent_run_shell` to normal users:

- The command runs in a separate `mita-computer-agent-runner.exe` process.
- The Tauri app remains the broker for settings, approvals, path validation,
  and output collection.
- The shell writes only inside the current thread workspace and configured
  Computer Agent allowed roots.
- Custom allowed roots receive temporary AppContainer ACL grants and are rolled
  back after each command.
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
- Keep `computer_agent_run_shell` unavailable on Windows.
- Add a runner binary scaffold that refuses execution.
- Make the settings UI show the runner phase and blockers.

Exit criteria:

- The main app can report why Windows shell is unavailable.
- A future runner can be swapped behind the protocol without changing chat
  tool routing or approval logic.

### Phase 1: local workspace-only prototype

Status: complete.

- Create an AppContainer profile per command or per thread.
- Grant the AppContainer SID access only to the thread workspace.
- Start the requested shell inside the AppContainer.
- Attach the child process to a Job Object.
- Kill the full Job Object on timeout.
- Capture capped stdout and stderr.
- Keep the feature behind explicit user settings and per-action approval.

Current implementation:

- `mita-computer-agent-runner.exe` validates the runner request and refuses direct
  execution unless the desktop app supplies its internal broker marker.
- The Biyan app exposes `computer_agent_run_shell` when the runner binary is
  discoverable and the user has enabled Computer Agent shell in settings. The app
  injects `MITA_COMPUTER_AGENT_RUNNER_EXECUTE=1` only into the runner child
  process after approval.
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

The Biyan app reports Windows shell as available when the packaged runner is
discoverable. The shell tool stays hidden unless the user enables Computer Agent
and the explicit shell setting; structured Computer Agent file tools still work
without enabling shell.

Exit criteria:

- The runner can write inside the workspace.
- Attempts to write outside the workspace fail in automated tests.
- Child processes are killed with the parent command.
- The command has no network access in automated tests.

### Phase 1.5: safety regression and packaged usability

Status: complete.

Implemented and verified:

- The Windows runner is built as part of the Windows Tauri build and packaged
  under `resources/computer-agent-runner/mita-computer-agent-runner.exe`.
- Runner discovery covers development, sidecar, and packaged resource paths.
- Installed app smoke testing covers both NSIS and MSI package layouts and
  confirms the full chat path:
  tool discovery -> one-time approval UI -> `computer_agent_run_shell` ->
  packaged runner -> thread workspace file output.
- The Windows MSI now uses a custom WiX template that defaults to current-user
  install (`ALLUSERS=2`, `MSIINSTALLPERUSER=1`) and still supports explicit
  all-users smoke coverage with `ALLUSERS=2` and an empty
  `MSIINSTALLPERUSER` from an elevated shell.
- `scripts/smoke-computer-agent-shell-installed.mjs` supports `--nsis`, `--msi`, and
  `--msi-scope per-user|all-users`. The same script clears stale per-user
  install registry state before temporary installs and restores the previous
  user artifacts afterwards.
- The approval UI shows the exact command, cwd, and affected paths, and
  Computer Agent tools cannot use global "allow all" or thread remembered
  permissions.
- `computer_agent_run_shell` now creates the private thread workspace before
  validating a relative cwd. The installed smoke test found this as a real
  regression: `cwd: "."` used to fail before the workspace existed.
- Security regressions cover outside-workspace writes, output truncation,
  timeout process-tree cleanup, loopback network blocking, and reparse point
  escape attempts.
- Before granting temporary workspace ACLs, the Windows runner rejects any
  reparse point below the workspace. Regression coverage includes junctions,
  directory symlinks, and file symlinks.
- Process-tree timeout regression coverage includes required cmd and
  PowerShell child-process tests. Node, Python, and Git Bash tests run when the
  interpreter is present and skip the final kill assertion only when the
  interpreter cannot start or cannot stay running inside the AppContainer on
  the current machine.
- Failed sandbox initialization returns a local diagnostic in the runner
  response message. The diagnostic includes the failed stage, reason, phase,
  next local troubleshooting step, and an explicit `Telemetry: none` marker.
  Covered stages include path resolution/validation, reparse scanning, stale
  sandbox cleanup, AppContainer profile creation, cleanup journal creation,
  workspace ACL grant, and sandbox process launch.

Validation run on 2026-05-16:

- `cargo test --manifest-path src-tauri/Cargo.toml computer --lib -- --nocapture`
  passed with 15 tests and 17 Windows runner tests ignored.
- `cargo test --manifest-path src-tauri/Cargo.toml computer --lib -- --ignored --nocapture --test-threads=1`
  passed the 17 Windows runner tests.
- `cargo build --manifest-path src-tauri/Cargo.toml --bin mita-computer-agent-runner --features computer-agent-runner`
  passed.
- `yarn prepare:computer-agent-runner:release` produced the packaged runner resource.
- `yarn tauri build --bundles msi` produced
  `src-tauri/target/release/bundle/msi/Biyan_0.6.599_x64_en-US.msi`.
- `yarn smoke:computer-agent-shell:win32 --msi --dry-run` verified MSI install,
  runner discovery, and isolated data setup.
- `yarn smoke:computer-agent-shell:win32 --msi` verified the MSI installed chat path
  through approval UI and wrote `smoke.txt` inside the temporary thread
  workspace.

### Phase 2: hardening

Completed from the original Phase 2 list:

- Scripted installed-app smoke testing. The Windows smoke entrypoint is
  `yarn smoke:computer-agent-shell:win32`.
- Fixed MSI per-user/all-users install policy so non-admin smoke testing can
  cover MSI per-user installs.
- Added reparse point and symlink escape tests.
- Added PowerShell, cmd, Node, Python, and Git Bash process-tree tests.
- Added explicit HKCU registry and user-profile read/write regression tests.
- Added a workspace cleanup journal outside the thread workspace. If the runner
  process is killed after granting ACLs, the next run for the same workspace
  removes the stale AppContainer ACL/profile record before starting a new
  sandbox.
- Added a crash regression that kills the runner mid-command, verifies the
  stale journal remains, then verifies the next run cleans it and leaves no
  AppContainer SID on the workspace ACL.
- Added telemetry-free diagnostics for failed sandbox initialization, plus
  regressions for diagnostic shape and a missing-workspace initialization
  failure.

Remaining hardening work:

- None currently tracked for Phase 2.

Exit criteria:

- Security tests fail closed.
- The shell tool remains hidden if any required Windows primitive is missing.

### Phase 3: allowed roots

Status: implemented and verified locally.

- Add temporary ACL grants for configured allowed roots.
- Refuse roots that cannot be canonicalized or safely ACL-managed.
- Roll back ACL grants after command completion.
- Keep custom roots opt-in and visible in the approval dialog.

Implementation notes:

- Runner protocol v2 includes `allowedRoots`.
- The app still resolves tool `cwd` through `ComputerAgentScope`, so shell cwd
  must be inside the private thread workspace or a configured allowed root.
- The runner canonicalizes the workspace, cwd, and every allowed root again
  inside the sidecar process.
- Windows shell roots must be local drive directories, not filesystem roots or
  UNC paths.
- Every sandbox root is scanned for reparse points before any ACL grant.
- The cleanup journal records every root that received an AppContainer ACL, so
  the next run can clean stale ACL/profile state after a runner crash.

Exit criteria:

- Allowed roots behave like the existing structured tools.
- ACL cleanup is verified after success, failure, and timeout.

Validation run on 2026-05-16:

- `cargo test --manifest-path src-tauri/Cargo.toml computer_agent --lib -- --nocapture`
  passed with 19 tests and 19 Windows runner tests ignored.
- `yarn prepare:computer-agent-runner` rebuilt the v2 runner binary.
- `cargo test --manifest-path src-tauri/Cargo.toml computer_agent --lib -- --ignored --nocapture --test-threads=1`
  passed all 19 Windows runner tests, including allowed-root write and timeout
  ACL cleanup.
- `yarn workspace @janhq/web-app build` passed.
- `yarn build:tauri:win32` produced fresh NSIS and MSI bundles with the v2
  runner packaged at `resources/computer-agent-runner/mita-computer-agent-runner.exe`.
- `yarn smoke:computer-agent-shell:win32 --nsis` passed against the installed
  app and wrote `allowed-root-smoke.txt` inside the configured temporary
  allowed root.
- `yarn smoke:computer-agent-shell:win32 --msi --msi-scope per-user` passed
  against the installed app and verified the same runner v2 + allowed-root
  shell path for the MSI per-user layout.

## Non-goals

- Do not run shell commands in the main Tauri process.
- Do not rely on `cwd` as a security boundary.
- Do not expose Windows shell unless the user has enabled the Computer Agent shell
  setting.
- Do not support permanent deletion through shell-specific shortcuts.
- Do not open the shell tool to the local OpenAI-compatible API in v1.
