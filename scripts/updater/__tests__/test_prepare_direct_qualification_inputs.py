import hashlib
import importlib.util
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from autoqa.migration_runner import select_migration_cases, validate_inputs


MODULE_PATH = Path(__file__).parents[1] / "prepare-direct-qualification-inputs.py"
SPEC = importlib.util.spec_from_file_location(
    "prepare_direct_qualification_inputs", MODULE_PATH
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PrepareDirectQualificationInputsTests(unittest.TestCase):
    def make_policy(self, root: Path, state: str = "candidate-pinned") -> tuple:
        candidate = root / "Biyan_0.6.648_x64-setup.exe"
        legacy_manual = root / "Mita_0.6.608_x64-setup.exe"
        legacy_auto = root / "Mita_0.6.611_x64-setup.exe"
        current = root / "Biyan_0.6.633_x64-setup.exe"
        phase_a = root / "Biyan_0.6.643_x64-setup.exe"
        phase_b = root / "Biyan_0.6.644_x64-setup.exe"
        terminal = root / "Biyan_0.6.645_x64-setup.exe"
        candidate.write_bytes(b"candidate")
        legacy_manual.write_bytes(b"legacy-manual")
        legacy_auto.write_bytes(b"legacy-auto")
        current.write_bytes(b"current")
        phase_a.write_bytes(b"phase-a")
        phase_b.write_bytes(b"phase-b")
        terminal.write_bytes(b"terminal")
        candidate_sha = digest(candidate) if state == "candidate-pinned" else None
        policy = {
            "schema": 1,
            "state": state,
            "deploymentMode": "direct-c",
            "candidate": {
                "version": "0.6.648",
                "tag": "v0.6.648",
                "sourceCommit": "33e8c5b03278b2b91318a553eb3b699b19c6ad1e",
                "migrationPhase": "C",
                "dataSchema": 3,
                "manifestKey": "biyan/updater/releases/v0.6.648/latest.json",
                "manifestSha256": "f" * 64 if state == "candidate-pinned" else None,
                "assets": {
                    "windows": {
                        "name": candidate.name,
                        "sha256": candidate_sha,
                    },
                    "macos": {
                        "name": "Biyan_0.6.648_universal.dmg",
                        "sha256": "a" * 64 if state == "candidate-pinned" else None,
                    },
                    "linux": {
                        "name": "Biyan_0.6.648_amd64.AppImage",
                        "sha256": "b" * 64 if state == "candidate-pinned" else None,
                    },
                },
            },
            "sources": {
                "0.6.608": {
                    "qualificationMode": "manual-installer",
                    "assets": {
                        "windows": {
                            "name": legacy_manual.name,
                            "sha256": digest(legacy_manual),
                        }
                    },
                },
                "0.6.611": {
                    "qualificationMode": "automatic-updater",
                    "assets": {
                        "windows": {
                            "name": legacy_auto.name,
                            "sha256": digest(legacy_auto),
                        }
                    },
                },
                "0.6.633": {
                    "assets": {
                        "windows": {
                            "name": current.name,
                            "sha256": digest(current),
                        }
                    }
                },
                "0.6.643": {
                    "assets": {
                        "windows": {
                            "name": phase_a.name,
                            "sha256": digest(phase_a),
                        }
                    }
                },
                "0.6.644": {
                    "assets": {
                        "windows": {
                            "name": phase_b.name,
                            "sha256": digest(phase_b),
                        }
                    }
                },
                "0.6.645": {
                    "assets": {
                        "windows": {
                            "name": terminal.name,
                            "sha256": digest(terminal),
                        }
                    }
                },
            },
            "lanes": [
                {
                    "id": "legacy-manual-to-c-windows",
                    "platform": "windows",
                    "scenario": "legacy-manual-to-c",
                    "sourceVersion": "0.6.608",
                    "sourceRole": "current",
                    "snapshot": "current",
                },
                {
                    "id": "legacy-auto-to-c-windows",
                    "platform": "windows",
                    "scenario": "legacy-auto-to-c",
                    "sourceVersion": "0.6.611",
                    "sourceRole": "current",
                    "snapshot": "current",
                },
                {
                    "id": "current-to-c-windows",
                    "platform": "windows",
                    "scenario": "current-to-c",
                    "sourceVersion": "0.6.633",
                    "sourceRole": "current",
                    "snapshot": "current",
                },
                {
                    "id": "a-to-c-windows",
                    "platform": "windows",
                    "scenario": "a-to-c",
                    "sourceVersion": "0.6.643",
                    "sourceRole": "a",
                    "snapshot": "a",
                },
                {
                    "id": "b-to-c-windows",
                    "platform": "windows",
                    "scenario": "b-to-c",
                    "sourceVersion": "0.6.644",
                    "sourceRole": "b",
                    "snapshot": "b",
                },
                {
                    "id": "c-to-c-windows",
                    "platform": "windows",
                    "scenario": "c-to-c",
                    "sourceVersion": "0.6.645",
                    "sourceRole": "current",
                    "snapshot": "current",
                },
            ],
        }
        policy_path = root / "policy.json"
        policy_path.write_text(json.dumps(policy), encoding="utf-8")
        return policy_path, policy, candidate, current, terminal

    def test_legacy_modes_are_distinct_and_use_the_generic_current_slot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy_path, policy, candidate, _, _ = self.make_policy(root)
            for lane_id, version, mode in (
                ("legacy-manual-to-c-windows", "0.6.608", "manual-installer"),
                ("legacy-auto-to-c-windows", "0.6.611", "automatic-updater"),
            ):
                source = root / policy["sources"][version]["assets"]["windows"]["name"]
                output_dir = root / lane_id
                manifest = MODULE.prepare_inputs(
                    policy_path=policy_path,
                    lane_id=lane_id,
                    candidate_installer=candidate,
                    source_installer=source,
                    output_dir=output_dir,
                )
                self.assertEqual(manifest["qualificationMode"], mode)
                self.assertEqual(set(manifest["installers"]), {"current", "c"})
                self.assertEqual(
                    manifest["snapshots"]["current"]["restore_to"],
                    "%APPDATA%/Mita/data",
                )

    def test_current_to_c_is_sanitized_and_deterministic(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy_path, _, candidate, current, _ = self.make_policy(root)
            first = root / "first"
            second = root / "second"
            manifest = MODULE.prepare_inputs(
                policy_path=policy_path,
                lane_id="current-to-c-windows",
                candidate_installer=candidate,
                source_installer=current,
                output_dir=first,
            )
            MODULE.prepare_inputs(
                policy_path=policy_path,
                lane_id="current-to-c-windows",
                candidate_installer=candidate,
                source_installer=current,
                output_dir=second,
            )
            self.assertEqual(manifest["scenario"], "current-to-c")
            self.assertEqual(set(manifest["installers"]), {"current", "c"})
            self.assertEqual(
                manifest["snapshots"]["current"]["restore_to"],
                "%APPDATA%/Biyan/data",
            )
            self.assertEqual(
                manifest["expectations"],
                {
                    "c": [
                        "%APPDATA%/Biyan/migration-state.json",
                        "%APPDATA%/Biyan/data/agent-workspaces/direct-qualification-preserved.txt",
                    ]
                },
            )
            self.assertEqual(
                manifest["sourceReadiness"],
                {
                    "phase": "current",
                    "version": "0.6.633",
                    "settings": "%APPDATA%/Mita/settings.json",
                    "dataRoot": "%APPDATA%/Biyan/data",
                    "store": "%APPDATA%/Biyan/data/store.json",
                    "mcpConfig": "%APPDATA%/Biyan/data/mcp_config.json",
                    "marker": (
                        "%APPDATA%/Biyan/data/agent-workspaces/"
                        "direct-qualification-preserved.txt"
                    ),
                    "requiredStore": {
                        "version": "0.6.633",
                        "mcp_version": 5,
                        "windows_biyan_migrated": True,
                    },
                },
            )
            self.assertEqual(
                digest(first / "snapshots/current.zip"),
                digest(second / "snapshots/current.zip"),
            )
            with zipfile.ZipFile(first / "snapshots/current.zip") as archive:
                self.assertEqual(
                    archive.namelist(),
                    [
                        "agent-workspaces/direct-qualification-preserved.txt",
                        "mcp_config.json",
                    ],
                )
                self.assertEqual(
                    json.loads(archive.read("mcp_config.json")),
                    {"mcpServers": {}},
                )
                canonical_data = root / "Biyan/data"
                archive.extractall(canonical_data)
            self.assertEqual(
                (
                    canonical_data
                    / "agent-workspaces/direct-qualification-preserved.txt"
                ).read_text(encoding="utf-8"),
                MODULE.MARKER_CONTENT,
            )

    def test_a_and_b_lanes_require_source_and_candidate_expectations(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy_path, policy, candidate, _, _ = self.make_policy(root)
            for lane_id, version, phase in (
                ("a-to-c-windows", "0.6.643", "a"),
                ("b-to-c-windows", "0.6.644", "b"),
            ):
                source = root / policy["sources"][version]["assets"]["windows"]["name"]
                output_dir = root / lane_id
                manifest = MODULE.prepare_inputs(
                    policy_path=policy_path,
                    lane_id=lane_id,
                    candidate_installer=candidate,
                    source_installer=source,
                    output_dir=output_dir,
                )
                self.assertEqual(
                    manifest["snapshots"][phase]["restore_to"],
                    "%APPDATA%/Biyan/data",
                )
                self.assertEqual(set(manifest["expectations"]), {phase, "c"})
                self.assertIsNone(manifest["sourceReadiness"])
                self.assertEqual(
                    manifest["expectations"][phase],
                    [
                        "%APPDATA%/Biyan/migration-state.json",
                        "%APPDATA%/Biyan/data/agent-workspaces/direct-qualification-preserved.txt",
                    ],
                )
                self.assertEqual(
                    manifest["expectations"][phase],
                    manifest["expectations"]["c"],
                )
                with mock.patch.dict(
                    os.environ,
                    {"APPDATA": str(root / "profile")},
                    clear=False,
                ):
                    validated = validate_inputs(
                        {phase: source, "c": candidate},
                        output_dir / "manifest.json",
                        "windows",
                        select_migration_cases([f"{phase}-to-c"]),
                    )
                self.assertEqual(set(validated.expectations), {phase, "c"})

    def test_terminal_c_to_c_uses_the_generic_current_slot(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy_path, _, candidate, _, terminal = self.make_policy(root)
            manifest = MODULE.prepare_inputs(
                policy_path=policy_path,
                lane_id="c-to-c-windows",
                candidate_installer=candidate,
                source_installer=terminal,
                output_dir=root / "output",
            )
            self.assertEqual(manifest["scenario"], "c-to-c")
            self.assertEqual(set(manifest["installers"]), {"current", "c"})
            self.assertEqual(
                manifest["snapshots"]["current"]["restore_to"],
                "%APPDATA%/Biyan/data",
            )

    def test_unpinned_policy_and_tampered_installer_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy_path, _, candidate, current, _ = self.make_policy(
                root, state="awaiting-candidate-pin"
            )
            with self.assertRaisesRegex(ValueError, "state=candidate-pinned"):
                MODULE.prepare_inputs(
                    policy_path=policy_path,
                    lane_id="current-to-c-windows",
                    candidate_installer=candidate,
                    source_installer=current,
                    output_dir=root / "unpinned",
                )

            policy_path, _, candidate, current, _ = self.make_policy(root)
            candidate.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                MODULE.prepare_inputs(
                    policy_path=policy_path,
                    lane_id="current-to-c-windows",
                    candidate_installer=candidate,
                    source_installer=current,
                    output_dir=root / "tampered",
                )


if __name__ == "__main__":
    unittest.main()
