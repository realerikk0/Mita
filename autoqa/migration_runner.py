#!/usr/bin/env python3
"""Fail-closed desktop migration matrix runner for dedicated AutoQA machines.

The snapshot bundle is intentionally external to the repository. Its manifest
pins every installer and snapshot by SHA-256 and marks the data as sanitized.
The runner restores a clean snapshot, installs every version in the scenario,
and requires each installed application to stay alive for a startup probe.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import signal
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import time
import zipfile
from dataclasses import dataclass
from functools import partial
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Mapping, Sequence, Tuple


PHASES: Tuple[str, ...] = ("current", "a", "b", "c")
SNAPSHOTS: Tuple[str, ...] = ("current", "a", "b", "fresh")


@dataclass(frozen=True)
class MigrationCase:
    name: str
    snapshot: str
    install_sequence: Tuple[str, ...]
    expected_phase: str


@dataclass(frozen=True)
class SnapshotSpec:
    name: str
    archive: Path
    sha256: str
    restore_to: Path


@dataclass(frozen=True)
class SourceReadinessSpec:
    phase: str
    version: str
    settings: Path
    data_root: Path
    store: Path
    mcp_config: Path
    marker: Path
    required_store: Mapping[str, object]


@dataclass(frozen=True)
class ValidatedInputs:
    installers: Mapping[str, Path]
    snapshots: Mapping[str, SnapshotSpec]
    expectations: Mapping[str, Tuple[Path, ...]]
    source_readiness: SourceReadinessSpec | None


class MigrationRunError(RuntimeError):
    """Preserve bounded diagnostics captured before destructive cleanup."""

    def __init__(self, message: str, diagnostics: Mapping[str, object]) -> None:
        super().__init__(message)
        self.diagnostics = dict(diagnostics)


class ReadinessFailed(RuntimeError):
    """A terminal readiness state which must not be retried."""


class ReadinessPending(RuntimeError):
    """A transient readiness state which may be retried until the deadline."""


def migration_matrix() -> Tuple[MigrationCase, ...]:
    return (
        MigrationCase("current-to-a", "current", ("current", "a"), "a"),
        MigrationCase("a-to-b", "a", ("a", "b"), "b"),
        MigrationCase(
            "current-to-a-to-b-to-c", "current", ("current", "a", "b", "c"), "c"
        ),
        MigrationCase("current-to-b", "current", ("current", "b"), "b"),
        MigrationCase("legacy-manual-to-c", "current", ("current", "c"), "c"),
        MigrationCase("legacy-auto-to-c", "current", ("current", "c"), "c"),
        MigrationCase("current-to-c", "current", ("current", "c"), "c"),
        MigrationCase("a-to-c", "a", ("a", "c"), "c"),
        MigrationCase("b-to-c", "b", ("b", "c"), "c"),
        # The source installer is passed through the generic "current" slot so
        # a terminal C patch can be exercised without weakening the fixed
        # A/B/C schema vocabulary used by the migration assertions.
        MigrationCase("c-to-c", "current", ("current", "c"), "c"),
        MigrationCase("fresh-a", "fresh", ("a",), "a"),
        MigrationCase("fresh-c", "fresh", ("c",), "c"),
    )


def select_migration_cases(
    scenarios: Sequence[str] | None = None,
) -> Tuple[MigrationCase, ...]:
    matrix = migration_matrix()
    if not scenarios:
        return matrix

    cases_by_name = {case.name: case for case in matrix}
    unknown = [name for name in scenarios if name not in cases_by_name]
    if unknown:
        raise ValueError(f"unknown migration scenario: {unknown[0]}")

    seen = set()
    for name in scenarios:
        if name in seen:
            raise ValueError(f"duplicate migration scenario: {name}")
        seen.add(name)
    return tuple(cases_by_name[name] for name in scenarios)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _expand_path(value: str) -> Path:
    expanded = value
    for name, replacement in os.environ.items():
        expanded = expanded.replace(f"%{name}%", replacement)
    expanded = os.path.expandvars(os.path.expanduser(expanded))
    return Path(expanded).resolve()


def _require_safe_restore_root(path: Path) -> None:
    allowed_roots = {
        Path.home().resolve(),
        *(
            Path(value).resolve()
            for value in (os.environ.get("APPDATA"), os.environ.get("LOCALAPPDATA"))
            if value
        ),
    }
    if not any(path == root or root in path.parents for root in allowed_roots):
        raise ValueError(
            f"snapshot restore path is outside the AutoQA user profile: {path}"
        )
    if path in allowed_roots:
        raise ValueError(
            f"snapshot restore path may not be an entire profile root: {path}"
        )


def _require_file(path: Path, label: str) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError(f"missing or empty {label}: {path}")


def _require_digest(path: Path, expected: str, label: str) -> None:
    if len(expected) != 64 or any(
        char not in "0123456789abcdefABCDEF" for char in expected
    ):
        raise ValueError(f"invalid SHA-256 for {label}")
    actual = _sha256(path)
    if actual != expected.lower():
        raise ValueError(
            f"SHA-256 mismatch for {label}: expected {expected}, got {actual}"
        )


def _require_exact_keys(
    value: Mapping[str, object],
    expected: Iterable[str],
    label: str,
) -> None:
    actual = set(value)
    exact = set(expected)
    if actual != exact:
        raise ValueError(
            f"{label} keys must be exact: expected {sorted(exact)}, got {sorted(actual)}"
        )


def _validate_source_readiness(
    value: object,
    manifest: Mapping[str, object],
    platform: str,
    selected_cases: Sequence[MigrationCase],
    snapshots: Mapping[str, SnapshotSpec],
) -> SourceReadinessSpec | None:
    exact_current_windows = (
        platform == "windows"
        and manifest.get("scenario") == "current-to-c"
        and [case.name for case in selected_cases] == ["current-to-c"]
    )
    if value is None:
        if exact_current_windows:
            raise ValueError(
                "current-to-c-windows requires the exact v0.6.633 sourceReadiness contract"
            )
        return None
    if not isinstance(value, dict):
        raise ValueError("snapshot manifest sourceReadiness must be an object or null")
    _require_exact_keys(
        value,
        (
            "phase",
            "version",
            "settings",
            "dataRoot",
            "store",
            "mcpConfig",
            "marker",
            "requiredStore",
        ),
        "sourceReadiness",
    )
    required_store = value.get("requiredStore")
    if not isinstance(required_store, dict):
        raise ValueError("sourceReadiness.requiredStore must be an object")
    _require_exact_keys(
        required_store,
        ("version", "mcp_version", "windows_biyan_migrated"),
        "sourceReadiness.requiredStore",
    )

    expected_raw = {
        "phase": "current",
        "version": "0.6.633",
        "settings": "%APPDATA%/Mita/settings.json",
        "dataRoot": "%APPDATA%/Biyan/data",
        "store": "%APPDATA%/Biyan/data/store.json",
        "mcpConfig": "%APPDATA%/Biyan/data/mcp_config.json",
        "marker": (
            "%APPDATA%/Biyan/data/agent-workspaces/direct-qualification-preserved.txt"
        ),
        "requiredStore": {
            "version": "0.6.633",
            "mcp_version": 5,
            "windows_biyan_migrated": True,
        },
    }
    exact_store = expected_raw["requiredStore"]
    exact_store_types = all(
        type(required_store.get(key)) is type(expected)
        and required_store.get(key) == expected
        for key, expected in exact_store.items()
    )
    if not exact_current_windows or value != expected_raw or not exact_store_types:
        raise ValueError(
            "sourceReadiness is allowed only for the exact "
            "current-to-c-windows v0.6.633 contract"
        )

    paths = {
        name: _expand_path(str(value[name]))
        for name in ("settings", "dataRoot", "store", "mcpConfig", "marker")
    }
    for path in paths.values():
        _require_safe_restore_root(path)
    current_snapshot = snapshots.get("current")
    if current_snapshot is None or paths["dataRoot"] != current_snapshot.restore_to:
        raise ValueError(
            "sourceReadiness.dataRoot must equal the current snapshot restore root"
        )
    for name in ("store", "mcpConfig", "marker"):
        if paths["dataRoot"] not in paths[name].parents:
            raise ValueError(f"sourceReadiness.{name} must remain inside dataRoot")

    return SourceReadinessSpec(
        phase="current",
        version="0.6.633",
        settings=paths["settings"],
        data_root=paths["dataRoot"],
        store=paths["store"],
        mcp_config=paths["mcpConfig"],
        marker=paths["marker"],
        required_store=dict(required_store),
    )


def validate_inputs(
    installer_paths: Mapping[str, Path],
    manifest_path: Path,
    platform: str,
    cases: Sequence[MigrationCase] | None = None,
) -> ValidatedInputs:
    selected_cases = tuple(cases) if cases is not None else migration_matrix()
    if not selected_cases:
        raise ValueError("at least one migration scenario is required")

    _require_file(manifest_path, "snapshot manifest")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schema") != 1:
        raise ValueError("snapshot manifest schema must be 1")
    if manifest.get("sanitized") is not True:
        raise ValueError("snapshot manifest must explicitly declare sanitized=true")
    if manifest.get("platform") != platform:
        raise ValueError(
            f"snapshot platform mismatch: expected {platform}, got {manifest.get('platform')}"
        )

    installer_manifest = manifest.get("installers")
    if not isinstance(installer_manifest, dict):
        raise ValueError("snapshot manifest is missing installer digests")
    validated_installers: Dict[str, Path] = {}
    required_phases = tuple(
        phase
        for phase in PHASES
        if any(phase in case.install_sequence for case in selected_cases)
    )
    for phase in required_phases:
        if phase not in installer_paths:
            raise FileNotFoundError(f"missing installer argument for phase {phase}")
        path = Path(installer_paths[phase]).resolve()
        _require_file(path, f"{phase} installer")
        entry = installer_manifest.get(phase)
        if not isinstance(entry, dict):
            raise ValueError(f"snapshot manifest is missing {phase} installer metadata")
        _require_digest(path, str(entry.get("sha256", "")), f"{phase} installer")
        validated_installers[phase] = path

    snapshot_manifest = manifest.get("snapshots")
    if not isinstance(snapshot_manifest, dict):
        raise ValueError("snapshot manifest is missing snapshots")
    snapshots: Dict[str, SnapshotSpec] = {}
    required_snapshots = tuple(
        name
        for name in SNAPSHOTS
        if any(case.snapshot == name for case in selected_cases)
    )
    for name in required_snapshots:
        entry = snapshot_manifest.get(name)
        if not isinstance(entry, dict):
            raise FileNotFoundError(
                f"snapshot manifest is missing required snapshot: {name}"
            )
        archive_value = entry.get("archive")
        restore_value = entry.get("restore_to")
        if not isinstance(archive_value, str) or not archive_value:
            raise FileNotFoundError(f"snapshot {name} has no archive")
        if not isinstance(restore_value, str) or not restore_value:
            raise ValueError(f"snapshot {name} has no restore_to path")
        manifest_root = manifest_path.parent.resolve()
        archive = (manifest_root / archive_value).resolve()
        if manifest_root != archive and manifest_root not in archive.parents:
            raise ValueError(
                f"snapshot {name} archive escapes the signed bundle: {archive_value}"
            )
        _require_file(archive, f"{name} sanitized snapshot")
        _require_digest(
            archive, str(entry.get("sha256", "")), f"{name} sanitized snapshot"
        )
        restore_to = _expand_path(restore_value)
        _require_safe_restore_root(restore_to)
        snapshots[name] = SnapshotSpec(name, archive, str(entry["sha256"]), restore_to)

    expectation_manifest = manifest.get("expectations")
    if not isinstance(expectation_manifest, dict):
        raise ValueError("snapshot manifest is missing post-migration expectations")
    expectations: Dict[str, Tuple[Path, ...]] = {}
    required_expectations = tuple(
        phase for phase in ("a", "b", "c") if phase in required_phases
    )
    for phase in required_expectations:
        values = expectation_manifest.get(phase)
        if (
            not isinstance(values, list)
            or not values
            or not all(isinstance(item, str) for item in values)
        ):
            raise ValueError(
                f"snapshot manifest must define non-empty expectations.{phase}"
            )
        expanded = tuple(_expand_path(item) for item in values)
        for path in expanded:
            _require_safe_restore_root(path)
        expectations[phase] = expanded

    # This also guards future edits to the matrix from silently introducing an
    # unvalidated installer or snapshot key.
    for case in selected_cases:
        if case.snapshot not in snapshots:
            raise FileNotFoundError(
                f"missing snapshot for scenario {case.name}: {case.snapshot}"
            )
        for phase in case.install_sequence:
            if phase not in validated_installers:
                raise FileNotFoundError(
                    f"missing installer for scenario {case.name}: {phase}"
                )

    source_readiness = _validate_source_readiness(
        manifest.get("sourceReadiness"),
        manifest,
        platform,
        selected_cases,
        snapshots,
    )
    return ValidatedInputs(
        validated_installers,
        snapshots,
        expectations,
        source_readiness,
    )


def _safe_extract(archive: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    destination_root = destination.resolve()

    def ensure_safe(names: Iterable[str]) -> None:
        for name in names:
            candidate = (destination_root / name).resolve()
            if (
                destination_root != candidate
                and destination_root not in candidate.parents
            ):
                raise ValueError(f"snapshot archive contains an unsafe path: {name}")

    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as bundle:
            members = bundle.infolist()
            ensure_safe(member.filename for member in members)
            for member in members:
                mode = member.external_attr >> 16
                if stat.S_IFMT(mode) == stat.S_IFLNK:
                    raise ValueError(
                        f"snapshot archive may not contain symbolic links: {member.filename}"
                    )
            bundle.extractall(destination_root)
        return
    if tarfile.is_tarfile(archive):
        with tarfile.open(archive) as bundle:
            members = bundle.getmembers()
            ensure_safe(member.name for member in members)
            for member in members:
                if not (member.isdir() or member.isfile()):
                    raise ValueError(
                        f"snapshot archive may contain only files and directories: {member.name}"
                    )
            bundle.extractall(destination_root)
        return
    raise ValueError(f"unsupported snapshot archive format: {archive}")


def _windows_install_diagnostics(install_root: Path) -> dict:
    """Return bounded, credential-free evidence for a silent-install failure."""

    local = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    roots = [
        install_root,
        *(
            local / "Programs" / product
            for product in ("Biyan", "Biyan-nightly", "Mita", "Silence", "Jan")
        ),
    ]
    snapshots = []
    for root in roots:
        entries = []
        truncated = False
        if root.is_dir():
            discovered = sorted(root.rglob("*"), key=lambda value: str(value).lower())
            truncated = len(discovered) > 200
            for entry in discovered[:200]:
                try:
                    relative = str(entry.relative_to(root))
                    entries.append(
                        {
                            "path": relative,
                            "kind": "file" if entry.is_file() else "directory",
                            "size": entry.stat().st_size if entry.is_file() else 0,
                        }
                    )
                except OSError as error:
                    entries.append(
                        {"path": str(entry), "error": error.__class__.__name__}
                    )
        snapshots.append(
            {
                "root": str(root),
                "exists": root.exists(),
                "entries": entries,
                "truncated": truncated,
            }
        )

    system = {"status": "unavailable-non-windows-test-host"}
    if sys.platform == "win32":
        script = r"""
$ErrorActionPreference = 'SilentlyContinue'
$uninstallRoots = @(
  'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
  'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$uninstall = Get-ItemProperty $uninstallRoots |
  Where-Object {
    $_.DisplayName -match '^(Biyan|Mita|Silence|Jan)(\s|$)'
  } |
  Select-Object -First 40 DisplayName, DisplayVersion, InstallLocation,
    Publisher, PSPath
$defender = Get-MpComputerStatus |
  Select-Object AMServiceEnabled, AntivirusEnabled, RealTimeProtectionEnabled,
    AntivirusSignatureLastUpdated
[ordered]@{
  uninstall = @($uninstall)
  defender = $defender
} | ConvertTo-Json -Depth 5 -Compress
"""
        try:
            completed = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    script,
                ],
                check=False,
                capture_output=True,
                text=True,
                timeout=30,
            )
            stdout = completed.stdout[:20_000]
            system = {
                "status": "captured" if completed.returncode == 0 else "command-failed",
                "returnCode": completed.returncode,
                "data": json.loads(stdout) if stdout.strip() else None,
                "stderrClass": "present" if completed.stderr else "empty",
            }
        except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
            system = {"status": "capture-error", "error": error.__class__.__name__}
    return {"schema": 1, "roots": snapshots, "system": system}


def _windows_product_processes(install_root: Path) -> List[dict]:
    """Return product processes or executables rooted in this qualification install."""

    if sys.platform != "win32":
        return []
    escaped_root = str(install_root).replace("'", "''")
    script = rf"""
$ErrorActionPreference = 'Stop'
$installRoot = [System.IO.Path]::GetFullPath('{escaped_root}').TrimEnd('\')
$matches = Get-CimInstance Win32_Process |
  Where-Object {{
    $_.ProcessId -ne $PID -and
    $_.ExecutablePath -and
    [System.IO.Path]::GetFullPath($_.ExecutablePath).StartsWith(
      $installRoot,
      [System.StringComparison]::OrdinalIgnoreCase
    )
  }} |
  Select-Object -First 40 ProcessId, ParentProcessId, Name, ExecutablePath
ConvertTo-Json -InputObject @($matches) -Depth 3 -Compress
"""
    completed = subprocess.run(
        [
            "powershell",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "failed to enumerate residual Windows product processes: "
            f"PowerShell exit {completed.returncode}"
        )
    try:
        payload = json.loads(completed.stdout or "[]")
    except json.JSONDecodeError as error:
        raise RuntimeError(
            "failed to parse residual Windows product process inventory"
        ) from error
    if not isinstance(payload, list) or not all(
        isinstance(item, dict) for item in payload
    ):
        raise RuntimeError(
            "residual Windows product process inventory must be an array"
        )
    return payload


class PlatformExecutor:
    def __init__(
        self,
        platform: str,
        startup_seconds: int,
        migration_timeout_seconds: int = 90,
    ) -> None:
        self.platform = platform
        self.startup_seconds = startup_seconds
        self.migration_timeout_seconds = migration_timeout_seconds
        self.last_executable: Path | None = None
        self.last_shutdown: dict | None = None

    def cleanup_installation(self) -> None:
        if self.platform == "windows":
            subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    "Get-Process Biyan,Mita,Silence,Jan -ErrorAction SilentlyContinue | "
                    "Stop-Process -Force -ErrorAction SilentlyContinue",
                ],
                check=False,
            )
            local = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
            for name in ("Biyan", "Biyan-nightly", "Mita", "Silence", "Jan"):
                shutil.rmtree(local / "Programs" / name, ignore_errors=True)
        elif self.platform == "macos":
            for name in ("Biyan", "Biyan-nightly", "Mita", "Silence", "Jan"):
                subprocess.run(["pkill", "-x", name], check=False)
            for name in ("Biyan", "Biyan-nightly", "Mita", "Silence", "Jan"):
                shutil.rmtree(Path("/Applications") / f"{name}.app", ignore_errors=True)
        else:
            for name in (
                "Biyan",
                "biyan",
                "Biyan-nightly",
                "biyan-nightly",
                "Mita",
                "mita",
                "Silence",
                "silence",
                "Jan",
                "jan",
            ):
                subprocess.run(["pkill", "-x", name], check=False)
            subprocess.run(
                [
                    "sudo",
                    "dpkg",
                    "--purge",
                    "biyan",
                    "biyan-nightly",
                    "mita",
                    "silence",
                    "jan",
                ],
                check=False,
                timeout=300,
            )
        self.last_executable = None
        self.last_shutdown = None

    def install(self, installer: Path, phase: str, case_dir: Path) -> Path:
        if self.platform == "windows":
            # NSIS requires /D=... to be the final argument. Pinning both the
            # source and candidate into one per-scenario root removes registry
            # and runner-image default-path ambiguity from upgrade evidence.
            install_root = case_dir / "windows-install"
            install_root.mkdir(parents=True, exist_ok=True)
            command = [str(installer), "/S", f"/D={install_root}"]
            try:
                subprocess.run(command, check=True, timeout=300)
            except subprocess.CalledProcessError as error:
                diagnostics = _windows_install_diagnostics(install_root)
                raise RuntimeError(
                    f"Windows installer failed for {phase} with exit "
                    f"{error.returncode}: {json.dumps(diagnostics, sort_keys=True)}"
                ) from error
            candidates = [
                install_root / f"{product}.exe"
                for product in ("Biyan", "Mita", "Silence", "Jan")
            ]
        elif self.platform == "macos":
            mount = case_dir / f"mount-{phase}"
            mount.mkdir(parents=True, exist_ok=True)
            subprocess.run(
                [
                    "hdiutil",
                    "attach",
                    str(installer),
                    "-mountpoint",
                    str(mount),
                    "-nobrowse",
                ],
                check=True,
                timeout=120,
            )
            try:
                apps = sorted(mount.glob("*.app"))
                if len(apps) != 1:
                    raise RuntimeError(
                        f"expected one app in {installer}, found {len(apps)}"
                    )
                target = Path("/Applications") / apps[0].name
                shutil.rmtree(target, ignore_errors=True)
                shutil.copytree(apps[0], target, symlinks=True)
            finally:
                subprocess.run(
                    ["hdiutil", "detach", str(mount)], check=False, timeout=120
                )
            candidates = sorted((target / "Contents" / "MacOS").iterdir())
        else:
            if installer.name.lower().endswith(".appimage"):
                executable = case_dir / installer.name
                shutil.copy2(installer, executable)
                executable.chmod(0o755)
                candidates = [executable]
            elif installer.name.lower().endswith(".deb"):
                subprocess.run(
                    ["sudo", "dpkg", "--force-downgrade", "-i", str(installer)],
                    check=False,
                    timeout=300,
                )
                subprocess.run(
                    ["sudo", "apt-get", "install", "-f", "-y"], check=True, timeout=300
                )
                candidates = [
                    prefix / name
                    for prefix in (Path("/usr/bin"), Path("/usr/local/bin"))
                    for name in (
                        "Biyan",
                        "biyan",
                        "Mita",
                        "mita",
                        "Silence",
                        "silence",
                        "Jan",
                        "jan",
                    )
                ]
            else:
                raise ValueError(f"unsupported Linux installer: {installer}")

        executable = next(
            (
                path
                for path in candidates
                if path.is_file() and os.access(path, os.X_OK)
            ),
            None,
        )
        if executable is None:
            if self.platform == "windows":
                diagnostics = _windows_install_diagnostics(case_dir / "windows-install")
                raise FileNotFoundError(
                    f"installed executable not found after {phase}: {installer}; "
                    f"diagnostics={json.dumps(diagnostics, sort_keys=True)}"
                )
            raise FileNotFoundError(
                f"installed executable not found after {phase}: {installer}"
            )
        if phase != "current" and "biyan" not in executable.name.lower():
            raise RuntimeError(
                f"phase {phase} did not install a Biyan executable: {executable}"
            )
        self.last_executable = executable
        return executable

    def _force_terminate_windows_process_tree(self, process: subprocess.Popen) -> None:
        completed = subprocess.run(
            [
                "taskkill",
                "/PID",
                str(process.pid),
                "/T",
                "/F",
            ],
            check=False,
            capture_output=True,
            timeout=30,
        )
        if completed.returncode != 0:
            raise RuntimeError(
                f"failed to terminate Windows process tree {process.pid}: "
                f"taskkill exit {completed.returncode}"
            )
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)

    def _gracefully_close_windows_process_tree(
        self,
        process: subprocess.Popen,
    ) -> None:
        started = time.monotonic()
        exit_code = process.poll()
        if exit_code is not None:
            self.last_shutdown = {
                "method": "wm-close",
                "rootPid": process.pid,
                "requested": False,
                "gracefulExited": False,
                "forcedCleanup": False,
                "elapsedMs": round((time.monotonic() - started) * 1000),
                "unexpectedExitCode": exit_code,
            }
            raise RuntimeError(
                "Windows source process exited before CloseMainWindow "
                f"with code {exit_code}"
            )
        script = (
            "$ErrorActionPreference = 'Stop'; "
            f"$process = Get-Process -Id {process.pid}; "
            "if (-not $process.CloseMainWindow()) { exit 3 }; "
            "if (-not $process.WaitForExit(30000)) { exit 4 }"
        )
        try:
            completed = subprocess.run(
                [
                    "powershell",
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    script,
                ],
                check=False,
                capture_output=True,
                timeout=40,
            )
            close_status: int | str = completed.returncode
        except (OSError, subprocess.SubprocessError) as error:
            completed = None
            close_status = error.__class__.__name__
        if completed is not None and completed.returncode == 0:
            try:
                process.wait(timeout=5)
                self.last_shutdown = {
                    "method": "wm-close",
                    "rootPid": process.pid,
                    "requested": True,
                    "gracefulExited": True,
                    "forcedCleanup": False,
                    "elapsedMs": round((time.monotonic() - started) * 1000),
                }
                return
            except subprocess.TimeoutExpired:
                pass

        # Cleanup is still mandatory, but a forced source shutdown invalidates
        # the next migration phase and therefore remains a lane failure.
        force_error: Exception | None = None
        try:
            self._force_terminate_windows_process_tree(process)
        except Exception as error:
            force_error = error
        self.last_shutdown = {
            "method": "wm-close",
            "rootPid": process.pid,
            "requested": True,
            "gracefulExited": False,
            "forcedCleanup": True,
            "elapsedMs": round((time.monotonic() - started) * 1000),
            "closeStatus": close_status,
        }
        if force_error is not None:
            self.last_shutdown["forceError"] = force_error.__class__.__name__
        raise RuntimeError(
            "Windows source process did not exit through CloseMainWindow; "
            f"close status {close_status}; forced cleanup used"
            + (f" but failed with {force_error}" if force_error is not None else "")
        )

    def _terminate_process_tree(
        self,
        process: subprocess.Popen,
        *,
        require_graceful: bool = False,
    ) -> None:
        if self.platform == "windows":
            if require_graceful:
                self._gracefully_close_windows_process_tree(process)
            else:
                started = time.monotonic()
                self._force_terminate_windows_process_tree(process)
                self.last_shutdown = {
                    "method": "force",
                    "rootPid": process.pid,
                    "requested": True,
                    "gracefulExited": False,
                    "forcedCleanup": True,
                    "elapsedMs": round((time.monotonic() - started) * 1000),
                }
            return

        process_group = process.pid
        try:
            os.killpg(process_group, signal.SIGTERM)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
        # The launcher may exit before an inherited child (notably xvfb-run).
        # Always target the isolated process group once more so no source build
        # can overlap the next installer or candidate probe.
        try:
            os.killpg(process_group, signal.SIGKILL)
        except ProcessLookupError:
            pass
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)

    def startup_probe(
        self,
        executable: Path,
        scenario: str,
        phase: str,
        readiness_check: Callable[[], None] | None = None,
        require_graceful_shutdown: bool = False,
    ) -> None:
        env = os.environ.copy()
        secret_prefixes = (
            "ACTIONS_",
            "ALIYUN_",
            "APPLE_",
            "AWS_",
            "AZURE_",
            "BIYAN_",
            "CLOUDFLARE_",
            "GCP_",
            "GITHUB_",
            "GOOGLE_",
            "OSS_",
            "TAURI_SIGNING_",
        )
        secret_names = {
            "GH_TOKEN",
            "NODE_AUTH_TOKEN",
            "NPM_TOKEN",
        }
        secret_fragments = ("PASSWORD", "PRIVATE_KEY", "SECRET", "TOKEN")
        for name in tuple(env):
            upper = name.upper()
            if (
                upper in secret_names
                or upper.startswith(secret_prefixes)
                or upper.endswith("_KEY")
                or any(fragment in upper for fragment in secret_fragments)
            ):
                env.pop(name, None)
        env.update(
            {
                "BIYAN_AUTOQA_MIGRATION_SCENARIO": scenario,
                "BIYAN_AUTOQA_MIGRATION_PHASE": phase,
            }
        )
        command: List[str] = [str(executable)]
        if (
            self.platform == "linux"
            and not env.get("DISPLAY")
            and shutil.which("xvfb-run")
        ):
            command = ["xvfb-run", "-a", *command]
        process_kwargs = {"env": env}
        if self.platform == "windows":
            process_kwargs["creationflags"] = getattr(
                subprocess,
                "CREATE_NEW_PROCESS_GROUP",
                0,
            )
        else:
            process_kwargs["start_new_session"] = True
        started = time.monotonic()
        process = subprocess.Popen(command, **process_kwargs)
        probe_error: Exception | None = None
        try:
            time.sleep(self.startup_seconds)
            exit_code = process.poll()
            if exit_code is not None:
                raise RuntimeError(
                    f"startup probe exited early for {scenario}/{phase} with code {exit_code}"
                )
            if readiness_check is not None:
                deadline = started + self.migration_timeout_seconds
                last_error: Exception | None = None
                while True:
                    exit_code = process.poll()
                    if exit_code is not None:
                        raise RuntimeError(
                            f"startup probe exited before migration readiness for "
                            f"{scenario}/{phase} with code {exit_code}; "
                            f"last readiness error: {last_error}"
                        )
                    try:
                        readiness_check()
                        break
                    except (FileNotFoundError, ReadinessPending) as error:
                        last_error = error

                    remaining = deadline - time.monotonic()
                    if remaining <= 0:
                        raise RuntimeError(
                            f"migration readiness timed out after "
                            f"{self.migration_timeout_seconds}s for {scenario}/{phase}; "
                            f"last readiness error: {last_error}"
                        )
                    time.sleep(min(1.0, remaining))
        except Exception as error:
            probe_error = error

        shutdown_error: Exception | None = None
        try:
            self._terminate_process_tree(
                process,
                require_graceful=require_graceful_shutdown,
            )
        except Exception as error:
            shutdown_error = error

        if probe_error is not None and shutdown_error is not None:
            raise RuntimeError(
                f"{probe_error}; shutdown also failed: {shutdown_error}"
            ) from probe_error
        if probe_error is not None:
            raise probe_error
        if shutdown_error is not None:
            raise shutdown_error

    def assert_no_residual_product_processes(self, install_root: Path) -> None:
        if self.platform != "windows":
            return
        residual = _windows_product_processes(install_root)
        if residual:
            raise RuntimeError(
                "residual Windows product processes remain after graceful source exit: "
                f"{json.dumps(residual, sort_keys=True)}"
            )


def _restore_snapshot(spec: SnapshotSpec) -> None:
    shutil.rmtree(spec.restore_to, ignore_errors=True)
    _safe_extract(spec.archive, spec.restore_to)


def _clear_qualification_roots(
    validated: ValidatedInputs,
    platform: str,
) -> None:
    roots = {snapshot.restore_to for snapshot in validated.snapshots.values()}
    # Never derive deletion authority from manifest expectations. The signed
    # snapshots name their exact restore roots; the only additional mutable
    # root is the platform's fixed Biyan configuration directory.
    roots.add(_migration_state_path(platform).parent)
    if validated.source_readiness is not None:
        # The exact v0.6.633 Windows contract keeps settings under Mita even
        # though its data root is Biyan/data. Clear that fixed configuration
        # root so a previous lane/run cannot redirect the source snapshot.
        roots.add(validated.source_readiness.settings.parent)
    for root in sorted(roots, key=lambda value: len(value.parts), reverse=True):
        shutil.rmtree(root, ignore_errors=True)


def _assert_phase_expectations(
    expectations: Mapping[str, Tuple[Path, ...]], scenario: str, phase: str
) -> None:
    expected = expectations.get(phase)
    if expected is None:
        return
    missing = [str(path) for path in expected if not path.exists()]
    if missing:
        raise FileNotFoundError(
            f"post-migration expectations failed for {scenario}/{phase}: {', '.join(missing)}"
        )


def _migration_state_path(platform: str) -> Path:
    if platform == "windows":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming"))
    elif platform == "macos":
        base = Path.home() / "Library/Application Support"
    else:
        base = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share"))
    return base / "Biyan/migration-state.json"


def _read_json_object(path: Path, label: str) -> dict:
    if not path.is_file():
        raise FileNotFoundError(f"{label} is missing: {path}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ReadinessPending(f"{label} is not valid UTF-8 JSON: {path}") from error
    if not isinstance(value, dict):
        raise ReadinessPending(f"{label} must contain a JSON object: {path}")
    return value


def _windows_path_identity(path: Path) -> str:
    return str(path).replace("\\", "/").rstrip("/").casefold()


def _assert_source_readiness(spec: SourceReadinessSpec) -> str:
    settings = _read_json_object(spec.settings, "source settings")
    configured_root = settings.get("data_folder")
    if not isinstance(configured_root, str) or _windows_path_identity(
        Path(configured_root)
    ) != _windows_path_identity(spec.data_root):
        raise ReadinessPending(
            "source settings data_folder mismatch: "
            f"expected {spec.data_root}, got {configured_root}"
        )

    store = _read_json_object(spec.store, "source store")
    for key, expected in spec.required_store.items():
        actual = store.get(key)
        if type(actual) is not type(expected) or actual != expected:
            raise ReadinessPending(
                f"source store {key} mismatch: expected exact "
                f"{type(expected).__name__} {expected!r}, got "
                f"{type(actual).__name__} {actual!r}"
            )
    mcp_config = _read_json_object(spec.mcp_config, "source MCP configuration")
    if not isinstance(mcp_config.get("mcpServers"), dict):
        raise ReadinessPending("source MCP configuration mcpServers must be an object")
    _require_file(spec.marker, "source preserved-data marker")

    digest = hashlib.sha256()
    for path in (spec.settings, spec.store, spec.mcp_config, spec.marker):
        digest.update(str(path).encode("utf-8"))
        digest.update(path.read_bytes())
    return digest.hexdigest()


def _stable_source_readiness(spec: SourceReadinessSpec) -> Callable[[], None]:
    last_digest: str | None = None
    consecutive = 0

    def check() -> None:
        nonlocal last_digest, consecutive
        digest = _assert_source_readiness(spec)
        if digest != last_digest:
            last_digest = digest
            consecutive = 1
            raise ReadinessPending(
                "source readiness requires a second stable observation"
            )
        consecutive += 1
        if consecutive < 2:
            raise ReadinessPending("source readiness has not stabilized")

    return check


def _assert_reversible_directory_rename(data_root: Path) -> None:
    if not data_root.is_dir():
        raise FileNotFoundError(
            f"source data root is missing before rename probe: {data_root}"
        )
    staging = data_root.parent / f".{data_root.name}.biyan-migrating"
    probe = data_root.parent / f".{data_root.name}.biyan-legacy-backup"
    conflicts = [path for path in (staging, probe) if path.exists()]
    if conflicts:
        raise RuntimeError(
            "source rename probe found migration path conflicts: "
            + ", ".join(str(path) for path in conflicts)
        )
    renamed = False
    try:
        data_root.rename(probe)
        renamed = True
        probe.rename(data_root)
        renamed = False
    except OSError as error:
        if renamed and probe.exists() and not data_root.exists():
            try:
                probe.rename(data_root)
                renamed = False
            except OSError:
                pass
        raise RuntimeError(
            f"source data root failed reversible rename probe: {error.__class__.__name__}"
        ) from error
    if renamed or not data_root.is_dir() or probe.exists():
        raise RuntimeError(
            "source data root rename probe did not restore the exact layout"
        )


def _assert_migration_state(state_path: Path, scenario: str, phase: str) -> None:
    if phase == "current":
        return
    if not state_path.is_file():
        raise FileNotFoundError(
            f"migration state is missing for {scenario}/{phase}: {state_path}"
        )
    state = _read_json_object(state_path, "migration state")
    failed_steps = [
        (step, details.get("error_code"))
        for step, details in state.get("steps", {}).items()
        if isinstance(details, dict) and details.get("status") == "failed"
    ]
    if failed_steps:
        detail = ", ".join(
            f"{step} (error_code={error_code!r})" for step, error_code in failed_steps
        )
        raise ReadinessFailed(f"migration step failed for {scenario}/{phase}: {detail}")
    expected_schema = {"a": 1, "b": 2, "c": 3}[phase]
    if state.get("data_schema") != expected_schema:
        raise ReadinessPending(
            f"migration schema mismatch for {scenario}/{phase}: "
            f"expected {expected_schema}, got {state.get('data_schema')}"
        )
    required_steps = [
        "layout_v1",
        "assistant_ids_v1",
        "mcp_names_v1",
        "extensions_manifest_v1",
    ]
    if expected_schema >= 2:
        required_steps.append("remote_only_v2")
    if expected_schema >= 3:
        required_steps.append("cleanup_v3")
    incomplete = [
        step
        for step in required_steps
        if state.get("steps", {}).get(step, {}).get("status") != "completed"
    ]
    if incomplete:
        raise ReadinessPending(
            f"migration steps incomplete for {scenario}/{phase}: {', '.join(incomplete)}"
        )


def _assert_phase_ready(
    validated: ValidatedInputs,
    platform: str,
    scenario: str,
    phase: str,
) -> None:
    _assert_phase_expectations(validated.expectations, scenario, phase)
    _assert_migration_state(_migration_state_path(platform), scenario, phase)


def _bounded_file_evidence(
    path: Path,
    *,
    parse_json: bool = False,
    max_bytes: int = 32_768,
) -> dict:
    if not path.is_file():
        return {"path": str(path), "exists": False}
    try:
        size = path.stat().st_size
        digest = _sha256(path)
        with path.open("rb") as stream:
            if max_bytes <= 0:
                tail = b""
            else:
                stream.seek(max(0, size - max_bytes))
                tail = stream.read(max_bytes)
    except OSError as error:
        return {
            "path": str(path),
            "exists": True,
            "readError": error.__class__.__name__,
        }
    result: Dict[str, Any] = {
        "path": str(path),
        "exists": True,
        "size": size,
        "sha256": digest,
        "truncated": size > max_bytes,
    }
    if max_bytes <= 0:
        return result
    try:
        text = tail.decode("utf-8")
        if parse_json and size <= max_bytes:
            result["json"] = json.loads(text)
        else:
            result["tail"] = text
    except (UnicodeDecodeError, json.JSONDecodeError):
        result["contentStatus"] = "non-utf8-or-invalid-json"
    return result


def _project_json_evidence(
    path: Path,
    projection: Callable[[Mapping[str, object]], Mapping[str, object]],
) -> dict:
    metadata = _bounded_file_evidence(path, max_bytes=0)
    if not metadata.get("exists"):
        return {**metadata, "valid": False}
    if metadata.get("size", 0) > 32_768:
        return {**metadata, "valid": False, "error": "json-too-large"}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("not-object")
        return {**metadata, "valid": True, **dict(projection(value))}
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
        return {**metadata, "valid": False, "error": error.__class__.__name__}


def _settings_evidence(path: Path) -> dict:
    return _project_json_evidence(
        path,
        lambda value: {"dataFolder": value.get("data_folder")},
    )


def _store_evidence(path: Path) -> dict:
    return _project_json_evidence(
        path,
        lambda value: {
            "version": value.get("version"),
            "mcpVersion": value.get("mcp_version"),
            "windowsBiyanMigrated": value.get("windows_biyan_migrated"),
        },
    )


def _mcp_evidence(path: Path) -> dict:
    def project(value: Mapping[str, object]) -> Mapping[str, object]:
        servers = value.get("mcpServers")
        return {
            "mcpServersIsObject": isinstance(servers, dict),
            "serverCount": len(servers) if isinstance(servers, dict) else None,
        }

    return _project_json_evidence(path, project)


def _migration_state_evidence(path: Path) -> dict:
    def project(value: Mapping[str, object]) -> Mapping[str, object]:
        steps = value.get("steps")
        projected_steps = {}
        if isinstance(steps, dict):
            for name, detail in sorted(steps.items()):
                if isinstance(detail, dict):
                    projected_steps[name] = {
                        "status": detail.get("status"),
                        "errorCode": detail.get("error_code"),
                    }
        return {
            "dataSchema": value.get("data_schema"),
            "steps": projected_steps,
        }

    return _project_json_evidence(path, project)


def _bounded_windows_logs(max_files: int = 3) -> List[dict]:
    local = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local"))
    log_root = local / "biyan/logs"
    if not log_root.is_dir():
        return []
    try:
        files = sorted(
            (path for path in log_root.glob("biyan-*.log") if path.is_file()),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
    except OSError as error:
        return [{"captureError": error.__class__.__name__}]
    return [
        # Never publish raw application log content. The hash/size identify
        # which bounded CI log existed, while migration state carries the
        # allowlisted step/error-code details needed for diagnosis.
        _bounded_file_evidence(path, max_bytes=0)
        for path in files[:max_files]
    ]


def _capture_failure_diagnostics(
    validated: ValidatedInputs,
    platform: str,
    scenario: str,
    phase_boundary: str,
    executable: Path | None,
    case_dir: Path,
    shutdown: Mapping[str, object] | None,
) -> dict:
    state_path = _migration_state_path(platform)
    config_root = state_path.parent
    diagnostics: Dict[str, Any] = {
        "schema": 1,
        "scenario": scenario,
        "phaseBoundary": phase_boundary,
        "migration": {
            "state": _migration_state_evidence(state_path),
            "lock": _bounded_file_evidence(config_root / ".migration.lock"),
        },
        "shutdown": dict(shutdown) if shutdown is not None else None,
        "captureErrors": [],
    }
    if executable is not None:
        diagnostics["executable"] = _bounded_file_evidence(
            executable,
            max_bytes=0,
        )
    if platform == "windows":
        appdata = Path(os.environ.get("APPDATA", Path.home() / "AppData/Roaming"))
        install_root = case_dir / "windows-install"
        diagnostics.update(
            {
                "source": {
                    "settings": _settings_evidence(appdata / "Mita/settings.json"),
                    "store": _store_evidence(appdata / "Biyan/data/store.json"),
                    "mcp": _mcp_evidence(appdata / "Biyan/data/mcp_config.json"),
                    "marker": _bounded_file_evidence(
                        appdata / "Biyan/data/agent-workspaces/"
                        "direct-qualification-preserved.txt",
                        max_bytes=0,
                    ),
                },
                "logs": _bounded_windows_logs(),
            }
        )
        try:
            diagnostics["install"] = _windows_install_diagnostics(install_root)
        except Exception as error:
            diagnostics["install"] = {"captureError": error.__class__.__name__}
            diagnostics["captureErrors"].append(f"install:{error.__class__.__name__}")
        try:
            diagnostics["residualProcesses"] = _windows_product_processes(install_root)
        except Exception as error:
            diagnostics["residualProcesses"] = {
                "captureError": error.__class__.__name__,
            }
            diagnostics["captureErrors"].append(
                f"residualProcesses:{error.__class__.__name__}"
            )
    if validated.source_readiness is not None:
        data_root = validated.source_readiness.data_root
        diagnostics["renameProbe"] = {
            "attempted": phase_boundary
            in {
                "source-rename-probe",
                "candidate-install",
                "candidate-readiness",
            },
            "dataRootExists": data_root.is_dir(),
            "stagingExists": (
                data_root.parent / f".{data_root.name}.biyan-migrating"
            ).exists(),
            "backupExists": (
                data_root.parent / f".{data_root.name}.biyan-legacy-backup"
            ).exists(),
        }
    return diagnostics


def run_matrix(
    validated: ValidatedInputs,
    platform: str,
    work_dir: Path,
    startup_seconds: int,
    migration_timeout_seconds: int = 90,
    cases: Sequence[MigrationCase] | None = None,
) -> List[dict]:
    selected_cases = tuple(cases) if cases is not None else migration_matrix()
    executor = PlatformExecutor(
        platform,
        startup_seconds,
        migration_timeout_seconds,
    )
    results: List[dict] = []
    try:
        for case in selected_cases:
            case_dir = work_dir / case.name
            executable: Path | None = None
            phase_boundary = "case-setup"
            try:
                shutil.rmtree(case_dir, ignore_errors=True)
                case_dir.mkdir(parents=True, exist_ok=True)
                executor.cleanup_installation()
                _clear_qualification_roots(validated, platform)
                phase_boundary = "snapshot-restore"
                _restore_snapshot(validated.snapshots[case.snapshot])
                started = time.time()
                for phase in case.install_sequence:
                    is_guarded_source = (
                        phase == "current" and validated.source_readiness is not None
                    )
                    phase_boundary = (
                        "source-install"
                        if is_guarded_source
                        else "candidate-install"
                        if phase == "c"
                        else f"{phase}-install"
                    )
                    executable = executor.install(
                        validated.installers[phase],
                        phase,
                        case_dir,
                    )
                    if is_guarded_source:
                        readiness_check = _stable_source_readiness(
                            validated.source_readiness
                        )
                        phase_boundary = "source-readiness"
                    elif phase == "current":
                        readiness_check = None
                    else:
                        readiness_check = partial(
                            _assert_phase_ready,
                            validated,
                            platform,
                            case.name,
                            phase,
                        )
                        phase_boundary = (
                            "candidate-readiness"
                            if phase == "c"
                            else f"{phase}-readiness"
                        )
                    executor.startup_probe(
                        executable,
                        case.name,
                        phase,
                        readiness_check,
                        require_graceful_shutdown=is_guarded_source,
                    )
                    if is_guarded_source:
                        phase_boundary = "source-residual-check"
                        executor.assert_no_residual_product_processes(
                            case_dir / "windows-install"
                        )
                        phase_boundary = "source-rename-probe"
                        _assert_reversible_directory_rename(
                            validated.source_readiness.data_root
                        )
                results.append(
                    {
                        "scenario": case.name,
                        "platform": platform,
                        "snapshot": case.snapshot,
                        "installSequence": list(case.install_sequence),
                        "expectedPhase": case.expected_phase,
                        "status": "passed",
                        "durationSeconds": round(time.time() - started, 3),
                    }
                )
            except Exception as error:
                try:
                    diagnostics = _capture_failure_diagnostics(
                        validated,
                        platform,
                        case.name,
                        phase_boundary,
                        executable,
                        case_dir,
                        executor.last_shutdown,
                    )
                except Exception as capture_error:
                    diagnostics = {
                        "schema": 1,
                        "scenario": case.name,
                        "phaseBoundary": phase_boundary,
                        "captureErrors": [capture_error.__class__.__name__],
                    }
                raise MigrationRunError(str(error), diagnostics) from error
    finally:
        executor.cleanup_installation()
        _clear_qualification_roots(validated, platform)
    return results


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the fail-closed Biyan migration matrix"
    )
    parser.add_argument(
        "--platform", choices=("windows", "linux", "macos"), required=True
    )
    for phase in PHASES:
        parser.add_argument(f"--{phase}-installer")
    parser.add_argument(
        "--scenario",
        action="append",
        help="Run only this named scenario; repeat for multiple scenarios (default: full matrix)",
    )
    parser.add_argument("--snapshot-manifest", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--work-dir", default="")
    parser.add_argument("--startup-seconds", type=int, default=10)
    parser.add_argument("--migration-timeout-seconds", type=int, default=90)
    parser.add_argument("--validate-only", action="store_true")
    parser.add_argument(
        "--allow-destructive-autoqa",
        choices=("AUTOQA",),
        help="Required for execution because snapshots replace data in a dedicated AutoQA profile",
    )
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    if args.startup_seconds <= 0:
        print("--startup-seconds must be greater than zero", file=sys.stderr)
        return 2
    if args.migration_timeout_seconds < args.startup_seconds:
        print(
            "--migration-timeout-seconds must be at least --startup-seconds",
            file=sys.stderr,
        )
        return 2
    installers = {
        phase: Path(value)
        for phase in PHASES
        if (value := getattr(args, f"{phase}_installer")) is not None
    }
    report_path = Path(args.report).resolve()
    report_path.parent.mkdir(parents=True, exist_ok=True)
    scenario_names = list(args.scenario or (case.name for case in migration_matrix()))
    try:
        cases = select_migration_cases(args.scenario)
        scenario_names = [case.name for case in cases]
        validated = validate_inputs(
            installers,
            Path(args.snapshot_manifest).resolve(),
            args.platform,
            cases,
        )
        if args.validate_only:
            results = [
                {
                    "scenario": case.name,
                    "platform": args.platform,
                    "snapshot": case.snapshot,
                    "installSequence": list(case.install_sequence),
                    "expectedPhase": case.expected_phase,
                    "status": "validated",
                }
                for case in cases
            ]
        else:
            if args.allow_destructive_autoqa != "AUTOQA":
                raise PermissionError(
                    "execution requires --allow-destructive-autoqa AUTOQA"
                )
            work_dir = (
                Path(args.work_dir).resolve()
                if args.work_dir
                else Path(tempfile.mkdtemp(prefix="biyan-migration-autoqa-"))
            )
            work_dir.mkdir(parents=True, exist_ok=True)
            results = run_matrix(
                validated,
                args.platform,
                work_dir,
                args.startup_seconds,
                args.migration_timeout_seconds,
                cases,
            )
        report = {
            "schema": 1,
            "platform": args.platform,
            "scenarios": scenario_names,
            "status": "passed",
            "matrix": results,
        }
        report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
        print(f"Migration matrix passed: {len(results)} scenarios")
        return 0
    except Exception as error:  # fail-closed report for CI evidence
        failed_report = {
            "schema": 1,
            "platform": args.platform,
            "scenarios": scenario_names,
            "status": "failed",
            "error": str(error),
        }
        if isinstance(error, MigrationRunError):
            failed_report["diagnostics"] = error.diagnostics
        report_path.write_text(
            json.dumps(failed_report, indent=2) + "\n",
            encoding="utf-8",
        )
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
