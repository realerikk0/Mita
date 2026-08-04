#!/usr/bin/env python3
"""Prepare one deterministic, sanitized terminal recovery qualification lane."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import sys
import zipfile
from pathlib import Path
from typing import Any, Mapping, Sequence


PLATFORMS = ("windows", "macos", "linux")
RUNNERS = {
    "windows": "windows-2022",
    "macos": "macos-15-intel",
    "linux": "ubuntu-24.04",
}
SCENARIO = "source-to-recovery"
CONTRACT_TYPE = "biyan-recovery-qualification-contract"
HARNESS_PATHS = sorted(
    (
        ".github/workflows/biyan-upgrade-smoke.yml",
        "autoqa/migration_runner.py",
        "scripts/updater/prepare-recovery-qualification-inputs.py",
        "scripts/updater/recovery-qualification-evidence.mjs",
    )
)
BIYAN_CONFIG_ROOTS = {
    "windows": "%APPDATA%/Biyan",
    "macos": "$HOME/Library/Application Support/Biyan",
    "linux": "$HOME/.local/share/Biyan",
}
BIYAN_DATA_ROOTS = {
    platform: f"{root}/data" for platform, root in BIYAN_CONFIG_ROOTS.items()
}
MARKER_PATH = "agent-workspaces/recovery-qualification-preserved.txt"
MARKER_CONTENT = "sanitized Biyan recovery-qualification preservation marker\n"
MCP_CONFIG_NAME = "mcp_config.json"
MCP_CONFIG_CONTENT = '{"mcpServers":{}}\n'


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_object(value: Any, label: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def require_exact_keys(
    value: Mapping[str, Any], expected: Sequence[str], label: str
) -> None:
    actual = sorted(value)
    wanted = sorted(expected)
    if actual != wanted:
        raise ValueError(
            f"{label} keys must be exactly {', '.join(wanted)}; "
            f"found {', '.join(actual) or '(none)'}"
        )


def require_sha256(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(f"{label} must be a pinned lowercase SHA-256")
    return value


def require_commit(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 40
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(f"{label} must be a lowercase commit SHA")
    return value


def require_positive_integer(value: Any, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValueError(f"{label} must be a positive integer")
    return value


def require_release(value: Any, label: str) -> Mapping[str, Any]:
    release = require_object(value, label)
    require_exact_keys(
        release,
        (
            "tag",
            "version",
            "sourceCommit",
            "migrationPhase",
            "dataSchema",
            "manifestSha256",
            "assets",
        ),
        label,
    )
    version = release.get("version")
    version_match = (
        re.fullmatch(r"([0-9]+)\.([0-9]+)\.([0-9]+)", version)
        if isinstance(version, str)
        else None
    )
    if (
        version_match is None
        or release.get("tag") != f"v{version}"
        or release.get("migrationPhase") != "C"
        or release.get("dataSchema") != 3
    ):
        raise ValueError(f"{label} must be an exact terminal C/schema-3 release")
    require_commit(release.get("sourceCommit"), f"{label}.sourceCommit")
    require_sha256(release.get("manifestSha256"), f"{label}.manifestSha256")
    assets = require_object(release.get("assets"), f"{label}.assets")
    require_exact_keys(assets, PLATFORMS, f"{label}.assets")
    expected_names = {
        "windows": f"Biyan_{version}_x64-setup.exe",
        "macos": f"Biyan_{version}_universal.dmg",
        "linux": f"Biyan_{version}_amd64.AppImage",
    }
    for platform in PLATFORMS:
        asset = require_object(assets.get(platform), f"{label}.assets.{platform}")
        require_exact_keys(asset, ("name", "sha256"), f"{label}.assets.{platform}")
        if asset.get("name") != expected_names[platform]:
            raise ValueError(f"{label}.assets.{platform}.name is not canonical")
        require_sha256(asset.get("sha256"), f"{label}.assets.{platform}.sha256")
    return release


def expected_lanes() -> list[dict[str, str]]:
    return [
        {
            "id": f"{SCENARIO}-{platform}",
            "platform": platform,
            "runner": RUNNERS[platform],
            "scenario": SCENARIO,
            "sourceRole": "current",
            "snapshot": "current",
        }
        for platform in PLATFORMS
    ]


def load_contract(path: Path) -> Mapping[str, Any]:
    try:
        contract = require_object(
            json.loads(path.read_text(encoding="utf-8")),
            "recovery qualification contract",
        )
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"recovery qualification contract is invalid: {error}") from error
    require_exact_keys(
        contract,
        (
            "schema",
            "type",
            "deploymentMode",
            "scenario",
            "source",
            "candidate",
            "workflow",
            "lanes",
        ),
        "recovery qualification contract",
    )
    if (
        contract.get("schema") != 1
        or contract.get("type") != CONTRACT_TYPE
        or contract.get("deploymentMode") != "recovery"
        or contract.get("scenario") != SCENARIO
    ):
        raise ValueError("recovery qualification contract identity is invalid")
    source = require_release(contract.get("source"), "contract.source")
    candidate = require_release(contract.get("candidate"), "contract.candidate")
    source_parts = tuple(int(part) for part in source["version"].split("."))
    candidate_parts = tuple(int(part) for part in candidate["version"].split("."))
    if candidate_parts <= source_parts:
        raise ValueError("recovery candidate must be newer than its source")
    if candidate["sourceCommit"] == source["sourceCommit"]:
        raise ValueError("recovery candidate must use a new source commit")
    workflow = require_object(contract.get("workflow"), "contract.workflow")
    require_exact_keys(
        workflow,
        (
            "name",
            "path",
            "headSha",
            "harnessPaths",
            "harnessSha256",
            "runId",
            "runAttempt",
        ),
        "contract.workflow",
    )
    if (
        workflow.get("name") != "Biyan Upgrade Smoke"
        or workflow.get("path") != ".github/workflows/biyan-upgrade-smoke.yml"
    ):
        raise ValueError("contract.workflow identity is invalid")
    require_commit(workflow.get("headSha"), "contract.workflow.headSha")
    require_sha256(workflow.get("harnessSha256"), "contract.workflow.harnessSha256")
    require_positive_integer(workflow.get("runId"), "contract.workflow.runId")
    require_positive_integer(workflow.get("runAttempt"), "contract.workflow.runAttempt")
    if workflow.get("harnessPaths") != HARNESS_PATHS:
        raise ValueError("contract.workflow.harnessPaths do not match the exact harness")
    if contract.get("lanes") != expected_lanes():
        raise ValueError("contract.lanes do not match the exact recovery matrix")
    return contract


def require_installer(
    path: Path,
    expected_name: str,
    expected_sha256: str,
    label: str,
) -> None:
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise FileNotFoundError(f"missing {label}: {path}") from error
    if (
        stat.S_ISLNK(metadata.st_mode)
        or not stat.S_ISREG(metadata.st_mode)
        or metadata.st_size == 0
    ):
        raise ValueError(f"{label} must be a non-empty regular file")
    if path.name != expected_name:
        raise ValueError(
            f"{label} name mismatch: expected {expected_name}, got {path.name}"
        )
    actual = sha256(path)
    if actual != expected_sha256:
        raise ValueError(
            f"{label} SHA-256 mismatch: expected {expected_sha256}, got {actual}"
        )


def write_snapshot(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ValueError(f"snapshot output may not be a symbolic link: {path}")
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, content in (
            (MARKER_PATH, MARKER_CONTENT),
            (MCP_CONFIG_NAME, MCP_CONFIG_CONTENT),
        ):
            entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.external_attr = 0o100600 << 16
            archive.writestr(entry, content)


def write_json(path: Path, value: Mapping[str, Any]) -> None:
    if path.is_symlink():
        raise ValueError(f"JSON output may not be a symbolic link: {path}")
    temporary = path.with_name(f".{path.name}.tmp")
    if temporary.exists() or temporary.is_symlink():
        raise ValueError(f"temporary output already exists: {temporary}")
    temporary.write_text(
        json.dumps(value, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def prepare_inputs(
    *,
    contract_path: Path,
    platform: str,
    source_installer: Path,
    candidate_installer: Path,
    output_dir: Path,
) -> dict[str, Any]:
    if platform not in PLATFORMS:
        raise ValueError(f"unsupported recovery platform: {platform}")
    contract = load_contract(contract_path)
    source_asset = contract["source"]["assets"][platform]
    candidate_asset = contract["candidate"]["assets"][platform]
    require_installer(
        source_installer,
        source_asset["name"],
        source_asset["sha256"],
        "source installer",
    )
    require_installer(
        candidate_installer,
        candidate_asset["name"],
        candidate_asset["sha256"],
        "candidate installer",
    )

    output_dir.mkdir(parents=True, exist_ok=True)
    if output_dir.is_symlink() or not output_dir.is_dir():
        raise ValueError("recovery output directory must be a regular directory")
    snapshot_path = output_dir / "snapshots/current.zip"
    write_snapshot(snapshot_path)
    state_path = f"{BIYAN_CONFIG_ROOTS[platform]}/migration-state.json"
    marker_path = f"{BIYAN_DATA_ROOTS[platform]}/{MARKER_PATH}"
    manifest = {
        "schema": 1,
        "sanitized": True,
        "platform": platform,
        "scenario": SCENARIO,
        "qualificationMode": "automatic-updater",
        "lane": f"{SCENARIO}-{platform}",
        "installers": {
            "current": {"sha256": source_asset["sha256"]},
            "c": {"sha256": candidate_asset["sha256"]},
        },
        "snapshots": {
            "current": {
                "archive": "snapshots/current.zip",
                "sha256": sha256(snapshot_path),
                "restore_to": BIYAN_DATA_ROOTS[platform],
            }
        },
        "expectations": {"c": [state_path, marker_path]},
        "sourceReadiness": None,
    }
    write_json(output_dir / "manifest.json", manifest)
    return manifest


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare one sanitized Biyan recovery qualification lane"
    )
    parser.add_argument("--contract", required=True)
    parser.add_argument("--platform", choices=PLATFORMS, required=True)
    parser.add_argument("--source-installer", required=True)
    parser.add_argument("--candidate-installer", required=True)
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        prepare_inputs(
            contract_path=Path(args.contract).resolve(),
            platform=args.platform,
            source_installer=Path(args.source_installer).resolve(),
            candidate_installer=Path(args.candidate_installer).resolve(),
            output_dir=Path(args.output_dir).resolve(),
        )
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
