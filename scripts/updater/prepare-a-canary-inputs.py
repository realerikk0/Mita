#!/usr/bin/env python3
"""Prepare deterministic, sanitized inputs for the focused A canary.

The released installers remain external inputs. This helper verifies them
against the reviewed A-canary policy and creates only the minimum snapshot
manifest needed by the selected platform scenario.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from pathlib import Path
from typing import Any, Mapping, Sequence


PLATFORMS = ("windows", "macos", "linux")
RESTORE_ROOTS = {
    "windows": "%APPDATA%/Biyan",
    "macos": "$HOME/Library/Application Support/Biyan",
    "linux": "$HOME/.local/share/Biyan",
}


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
        raise ValueError(f"{label} must be a lowercase SHA-256")
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
            archive.writestr(
                "canary-preserved.txt",
                "sanitized Biyan A-canary preservation marker\n",
            )


def prepare_inputs(
    *,
    policy_path: Path,
    platform: str,
    candidate_installer: Path,
    current_installer: Path | None,
    output_dir: Path,
) -> dict[str, Any]:
    if platform not in PLATFORMS:
        raise ValueError(f"unsupported platform: {platform}")
    policy = require_object(
        json.loads(policy_path.read_text(encoding="utf-8")), "A canary policy"
    )
    if policy.get("schema") != 1:
        raise ValueError("A canary policy schema must be 1")
    platforms = require_object(policy.get("platforms"), "policy.platforms")
    platform_policy = require_object(
        platforms.get(platform), f"policy.platforms.{platform}"
    )
    scenario = platform_policy.get("scenario")
    expected_scenario = "fresh-a" if platform == "linux" else "current-to-a"
    if scenario != expected_scenario:
        raise ValueError(
            f"{platform} scenario must be exactly {expected_scenario}"
        )

    candidate_asset = require_object(
        platform_policy.get("candidateAsset"),
        f"policy.platforms.{platform}.candidateAsset",
    )
    candidate_sha = require_sha256(
        candidate_asset.get("sha256"), f"{platform} candidate asset SHA-256"
    )
    if candidate_installer.name != candidate_asset.get("name"):
        raise ValueError(
            f"{platform} candidate asset name mismatch: "
            f"expected {candidate_asset.get('name')}, got {candidate_installer.name}"
        )
    require_file_digest(candidate_installer, candidate_sha, "candidate installer")

    installers: dict[str, dict[str, str]] = {
        "a": {"sha256": candidate_sha},
    }
    snapshot_name = "fresh" if scenario == "fresh-a" else "current"
    marker = scenario == "current-to-a"

    if scenario == "current-to-a":
        current_asset = require_object(
            platform_policy.get("currentAsset"),
            f"policy.platforms.{platform}.currentAsset",
        )
        current_sha = require_sha256(
            current_asset.get("sha256"), f"{platform} current asset SHA-256"
        )
        if current_installer is None:
            raise FileNotFoundError(
                f"{platform} current-to-a requires the released current installer"
            )
        if current_installer.name != current_asset.get("name"):
            raise ValueError(
                f"{platform} current asset name mismatch: "
                f"expected {current_asset.get('name')}, got {current_installer.name}"
            )
        require_file_digest(current_installer, current_sha, "current installer")
        installers["current"] = {"sha256": current_sha}
    else:
        if current_installer is not None:
            raise ValueError("fresh-a must not accept a fabricated Linux current installer")
        exception = require_object(
            platform_policy.get("compatibilityException"),
            "policy.platforms.linux.compatibilityException",
        )
        current = require_object(policy.get("current"), "policy.current")
        if (
            exception.get("code") != "no-production-current-linux-artifact"
            or exception.get("currentVersion") != current.get("version")
            or exception.get("currentManifestSha256")
            != current.get("manifestSha256")
        ):
            raise ValueError("Linux fresh-a compatibility exception is not exact")

    output_dir.mkdir(parents=True, exist_ok=True)
    snapshot_path = output_dir / "snapshots" / f"{snapshot_name}.zip"
    write_snapshot(snapshot_path, marker=marker)
    restore_root = RESTORE_ROOTS[platform]
    expectations = [f"{restore_root}/migration-state.json"]
    if marker:
        expectations.append(f"{restore_root}/canary-preserved.txt")

    manifest = {
        "schema": 1,
        "sanitized": True,
        "platform": platform,
        "scenario": scenario,
        "installers": installers,
        "snapshots": {
            snapshot_name: {
                "archive": f"snapshots/{snapshot_name}.zip",
                "sha256": sha256(snapshot_path),
                "restore_to": restore_root,
            }
        },
        "expectations": {"a": expectations},
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return manifest


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Prepare sanitized inputs for the focused Biyan A canary"
    )
    parser.add_argument("--policy", required=True)
    parser.add_argument("--platform", choices=PLATFORMS, required=True)
    parser.add_argument("--candidate-installer", required=True)
    parser.add_argument("--current-installer")
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args(argv)


def main(argv: Sequence[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        prepare_inputs(
            policy_path=Path(args.policy).resolve(),
            platform=args.platform,
            candidate_installer=Path(args.candidate_installer).resolve(),
            current_installer=(
                Path(args.current_installer).resolve()
                if args.current_installer
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
