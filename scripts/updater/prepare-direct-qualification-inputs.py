#!/usr/bin/env python3
"""Prepare one deterministic, sanitized DIRECT_C qualification lane."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from typing import Any, Mapping, Sequence


PLATFORMS = ("windows", "macos", "linux")
BIYAN_CONFIG_ROOTS = {
    "windows": "%APPDATA%/Biyan",
    "macos": "$HOME/Library/Application Support/Biyan",
    "linux": "$HOME/.local/share/Biyan",
}
LEGACY_DATA_ROOTS = {
    "windows": "%APPDATA%/Mita/data",
    "macos": "$HOME/Library/Application Support/Mita/data",
    "linux": "$HOME/.local/share/Mita/data",
}
BIYAN_DATA_ROOTS = {
    platform: f"{root}/data" for platform, root in BIYAN_CONFIG_ROOTS.items()
}
MARKER_PATH = "agent-workspaces/direct-qualification-preserved.txt"
MARKER_CONTENT = "sanitized Biyan direct-qualification preservation marker\n"
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


def require_sha256(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ValueError(f"{label} must be a pinned lowercase SHA-256")
    return value


def require_file_digest(path: Path, expected: str, label: str) -> None:
    if not path.is_file() or path.stat().st_size == 0:
        raise FileNotFoundError(f"missing or empty {label}: {path}")
    actual = sha256(path)
    if actual != expected:
        raise ValueError(
            f"{label} SHA-256 mismatch: expected {expected}, got {actual}"
        )


def write_snapshot(path: Path, marker: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        if marker:
            for name, content in (
                (MARKER_PATH, MARKER_CONTENT),
                (MCP_CONFIG_NAME, MCP_CONFIG_CONTENT),
            ):
                entry = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100600 << 16
                archive.writestr(entry, content)


def prepare_inputs(
    *,
    policy_path: Path,
    lane_id: str,
    candidate_installer: Path,
    source_installer: Path | None,
    output_dir: Path,
) -> dict[str, Any]:
    policy = require_object(
        json.loads(policy_path.read_text(encoding="utf-8")),
        "direct qualification policy",
    )
    if (
        policy.get("schema") != 1
        or policy.get("state") != "candidate-pinned"
        or policy.get("deploymentMode") != "direct-c"
    ):
        raise ValueError(
            "direct qualification requires policy.state=candidate-pinned"
        )

    lanes = policy.get("lanes")
    if not isinstance(lanes, list):
        raise ValueError("policy.lanes must be an array")
    matches = [lane for lane in lanes if isinstance(lane, dict) and lane.get("id") == lane_id]
    if len(matches) != 1:
        raise ValueError(f"lane must exist exactly once: {lane_id}")
    lane = matches[0]
    platform = lane.get("platform")
    if platform not in PLATFORMS:
        raise ValueError(f"unsupported lane platform: {platform}")

    candidate = require_object(policy.get("candidate"), "policy.candidate")
    if (
        candidate.get("version") != "0.6.646"
        or candidate.get("tag") != "v0.6.646"
        or candidate.get("sourceCommit")
        != "581ebf6b19ef407a9645d0b318792f1012f8f75b"
        or candidate.get("migrationPhase") != "C"
        or candidate.get("dataSchema") != 3
        or candidate.get("manifestKey")
        != "biyan/updater/releases/v0.6.646/latest.json"
    ):
        raise ValueError("candidate identity must be exact v0.6.646/C/schema 3")
    require_sha256(
        candidate.get("manifestSha256"),
        "candidate manifest SHA-256",
    )
    candidate_assets = require_object(
        candidate.get("assets"),
        "policy.candidate.assets",
    )
    for candidate_platform in PLATFORMS:
        require_sha256(
            require_object(
                candidate_assets.get(candidate_platform),
                f"policy.candidate.assets.{candidate_platform}",
            ).get("sha256"),
            f"{candidate_platform} candidate asset SHA-256",
        )
    candidate_asset = require_object(
        candidate_assets.get(platform),
        f"policy.candidate.assets.{platform}",
    )
    candidate_sha = require_sha256(
        candidate_asset.get("sha256"),
        f"{platform} candidate asset SHA-256",
    )
    if candidate_installer.name != candidate_asset.get("name"):
        raise ValueError(
            f"{platform} candidate asset name mismatch: "
            f"expected {candidate_asset.get('name')}, got {candidate_installer.name}"
        )
    require_file_digest(candidate_installer, candidate_sha, "candidate installer")

    scenario = lane.get("scenario")
    snapshot_name = lane.get("snapshot")
    source_version = lane.get("sourceVersion")
    source_role = lane.get("sourceRole")
    installers: dict[str, dict[str, str]] = {"c": {"sha256": candidate_sha}}

    if scenario == "fresh-c":
        qualification_mode = "fresh-install"
        if (
            platform != "linux"
            or snapshot_name != "fresh"
            or source_version is not None
            or source_role is not None
        ):
            raise ValueError("fresh-c is only the exact source-free Linux lane")
        if source_installer is not None:
            raise ValueError("fresh-c must not accept a source installer")
    else:
        if (
            not isinstance(source_version, str)
            or source_role not in ("current", "a", "b")
            or snapshot_name not in ("current", "a", "b")
        ):
            raise ValueError(f"upgrade lane identity is invalid: {lane_id}")
        expected = {
            "legacy-manual-to-c": (
                "0.6.608",
                "current",
                "current",
                "manual-installer",
            ),
            "legacy-auto-to-c": (
                "0.6.611",
                "current",
                "current",
                "automatic-updater",
            ),
            "current-to-c": (
                "0.6.633",
                "current",
                "current",
                "automatic-updater",
            ),
            "a-to-c": ("0.6.643", "a", "a", "automatic-updater"),
            "b-to-c": ("0.6.644", "b", "b", "automatic-updater"),
            "c-to-c": (
                "0.6.645",
                "current",
                "current",
                "automatic-updater",
            ),
        }.get(scenario)
        if expected is None or expected[:3] != (
            source_version,
            source_role,
            snapshot_name,
        ):
            raise ValueError(f"upgrade lane tuple is not approved: {lane_id}")
        qualification_mode = expected[3]
        if source_installer is None:
            raise FileNotFoundError(f"{lane_id} requires its pinned source installer")
        source = require_object(
            require_object(policy.get("sources"), "policy.sources").get(source_version),
            f"policy.sources.{source_version}",
        )
        if source_version in ("0.6.608", "0.6.611") and source.get(
            "qualificationMode"
        ) != qualification_mode:
            raise ValueError(
                f"{lane_id} source qualification mode is not exact"
            )
        source_asset = require_object(
            require_object(source.get("assets"), f"policy.sources.{source_version}.assets").get(
                platform
            ),
            f"policy.sources.{source_version}.assets.{platform}",
        )
        source_sha = require_sha256(
            source_asset.get("sha256"),
            f"{platform} source asset SHA-256",
        )
        if source_installer.name != source_asset.get("name"):
            raise ValueError(
                f"{platform} source asset name mismatch: "
                f"expected {source_asset.get('name')}, got {source_installer.name}"
            )
        require_file_digest(source_installer, source_sha, "source installer")
        installers[source_role] = {"sha256": source_sha}

    output_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = output_dir / "snapshots" / f"{snapshot_name}.zip"
    marker = scenario != "fresh-c"
    write_snapshot(snapshot_path, marker=marker)
    # v0.6.633 kept its configuration under Mita, but productName=Biyan made
    # its default user data root Biyan/data. Only the two Mita-branded sources
    # therefore restore snapshots into the legacy data root.
    restore_root = (
        LEGACY_DATA_ROOTS[platform]
        if source_version in ("0.6.608", "0.6.611")
        else BIYAN_DATA_ROOTS[platform]
    )
    state_path = f"{BIYAN_CONFIG_ROOTS[platform]}/migration-state.json"
    marker_path = f"{BIYAN_DATA_ROOTS[platform]}/{MARKER_PATH}"
    required_phases = [
        *([source_role] if source_role in ("a", "b") else []),
        "c",
    ]
    expectations = {
        phase: [state_path, *([marker_path] if marker else [])]
        for phase in required_phases
    }

    manifest = {
        "schema": 1,
        "sanitized": True,
        "platform": platform,
        "scenario": scenario,
        "qualificationMode": qualification_mode,
        "lane": lane_id,
        "installers": installers,
        "snapshots": {
            snapshot_name: {
                "archive": f"snapshots/{snapshot_name}.zip",
                "sha256": sha256(snapshot_path),
                "restore_to": restore_root,
            }
        },
        "expectations": expectations,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare one sanitized Biyan DIRECT_C qualification lane"
    )
    parser.add_argument("--policy", required=True)
    parser.add_argument("--lane", required=True)
    parser.add_argument("--candidate-installer", required=True)
    parser.add_argument("--source-installer")
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        prepare_inputs(
            policy_path=Path(args.policy).resolve(),
            lane_id=args.lane,
            candidate_installer=Path(args.candidate_installer).resolve(),
            source_installer=(
                Path(args.source_installer).resolve()
                if args.source_installer
                else None
            ),
            output_dir=Path(args.output_dir).resolve(),
        )
        return 0
    except Exception as error:
        print(str(error), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
