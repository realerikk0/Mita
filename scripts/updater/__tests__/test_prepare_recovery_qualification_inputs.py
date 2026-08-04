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


MODULE_PATH = Path(__file__).parents[1] / "prepare-recovery-qualification-inputs.py"
SPEC = importlib.util.spec_from_file_location(
    "prepare_recovery_qualification_inputs", MODULE_PATH
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PrepareRecoveryQualificationInputsTests(unittest.TestCase):
    def make_contract(self, root: Path) -> tuple[Path, dict, dict[str, tuple[Path, Path]]]:
        assets: dict[str, tuple[Path, Path]] = {}
        source_assets = {}
        candidate_assets = {}
        names = {
            "windows": ("Biyan_0.6.649_x64-setup.exe", "Biyan_0.6.650_x64-setup.exe"),
            "macos": ("Biyan_0.6.649_universal.dmg", "Biyan_0.6.650_universal.dmg"),
            "linux": ("Biyan_0.6.649_amd64.AppImage", "Biyan_0.6.650_amd64.AppImage"),
        }
        for platform, (source_name, candidate_name) in names.items():
            source = root / source_name
            candidate = root / candidate_name
            source.write_bytes(f"source-{platform}".encode())
            candidate.write_bytes(f"candidate-{platform}".encode())
            assets[platform] = (source, candidate)
            source_assets[platform] = {
                "name": source.name,
                "sha256": digest(source),
            }
            candidate_assets[platform] = {
                "name": candidate.name,
                "sha256": digest(candidate),
            }
        contract = {
            "schema": 1,
            "type": MODULE.CONTRACT_TYPE,
            "deploymentMode": "recovery",
            "scenario": MODULE.SCENARIO,
            "source": {
                "tag": "v0.6.649",
                "version": "0.6.649",
                "sourceCommit": "a" * 40,
                "migrationPhase": "C",
                "dataSchema": 3,
                "manifestSha256": "b" * 64,
                "assets": source_assets,
            },
            "candidate": {
                "tag": "v0.6.650",
                "version": "0.6.650",
                "sourceCommit": "c" * 40,
                "migrationPhase": "C",
                "dataSchema": 3,
                "manifestSha256": "d" * 64,
                "assets": candidate_assets,
            },
            "workflow": {
                "name": "Biyan Upgrade Smoke",
                "path": ".github/workflows/biyan-upgrade-smoke.yml",
                "headSha": "e" * 40,
                "harnessPaths": sorted(
                    [
                        ".github/workflows/biyan-upgrade-smoke.yml",
                        "autoqa/migration_runner.py",
                        "scripts/updater/prepare-recovery-qualification-inputs.py",
                        "scripts/updater/recovery-qualification-evidence.mjs",
                    ]
                ),
                "harnessSha256": "f" * 64,
                "runId": 123,
                "runAttempt": 1,
            },
            "lanes": MODULE.expected_lanes(),
        }
        contract_path = root / "contract.json"
        contract_path.write_text(json.dumps(contract), encoding="utf-8")
        return contract_path, contract, assets

    def test_all_platforms_emit_deterministic_sanitized_runner_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract_path, _, assets = self.make_contract(root)
            cases = select_migration_cases(["source-to-recovery"])
            for platform in MODULE.PLATFORMS:
                with self.subTest(platform=platform):
                    first = root / f"{platform}-first"
                    second = root / f"{platform}-second"
                    source, candidate = assets[platform]
                    manifest = MODULE.prepare_inputs(
                        contract_path=contract_path,
                        platform=platform,
                        source_installer=source,
                        candidate_installer=candidate,
                        output_dir=first,
                    )
                    MODULE.prepare_inputs(
                        contract_path=contract_path,
                        platform=platform,
                        source_installer=source,
                        candidate_installer=candidate,
                        output_dir=second,
                    )
                    self.assertEqual(manifest["scenario"], "source-to-recovery")
                    self.assertEqual(
                        manifest["lane"],
                        f"source-to-recovery-{platform}",
                    )
                    self.assertEqual(
                        manifest["qualificationMode"],
                        "automatic-updater",
                    )
                    self.assertEqual(set(manifest["installers"]), {"current", "c"})
                    self.assertEqual(set(manifest["snapshots"]), {"current"})
                    self.assertEqual(set(manifest["expectations"]), {"c"})
                    self.assertIsNone(manifest["sourceReadiness"])
                    self.assertEqual(
                        digest(first / "snapshots/current.zip"),
                        digest(second / "snapshots/current.zip"),
                    )
                    with zipfile.ZipFile(first / "snapshots/current.zip") as archive:
                        self.assertEqual(
                            archive.namelist(),
                            [
                                MODULE.MARKER_PATH,
                                MODULE.MCP_CONFIG_NAME,
                            ],
                        )
                        self.assertEqual(
                            json.loads(archive.read(MODULE.MCP_CONFIG_NAME)),
                            {"mcpServers": {}},
                        )

                    environment = {
                        "APPDATA": str(root / "appdata"),
                        "HOME": str(root / "home"),
                        "XDG_DATA_HOME": str(root / "xdg"),
                    }
                    with mock.patch.dict(os.environ, environment, clear=False):
                        validated = validate_inputs(
                            {"current": source, "c": candidate},
                            first / "manifest.json",
                            platform,
                            cases,
                        )
                    self.assertEqual(set(validated.installers), {"current", "c"})
                    self.assertEqual(set(validated.snapshots), {"current"})

    def test_contract_and_installer_tampering_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract_path, contract, assets = self.make_contract(root)
            source, candidate = assets["windows"]

            candidate.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                MODULE.prepare_inputs(
                    contract_path=contract_path,
                    platform="windows",
                    source_installer=source,
                    candidate_installer=candidate,
                    output_dir=root / "tampered",
                )

            candidate.write_bytes(b"candidate-windows")
            contract["candidate"]["dataSchema"] = 2
            contract_path.write_text(json.dumps(contract), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "terminal C/schema-3"):
                MODULE.prepare_inputs(
                    contract_path=contract_path,
                    platform="windows",
                    source_installer=source,
                    candidate_installer=candidate,
                    output_dir=root / "wrong-schema",
                )

    def test_installer_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            contract_path, _, assets = self.make_contract(root)
            source, candidate = assets["linux"]
            target = root / "source-target.AppImage"
            source.replace(target)
            source.symlink_to(target)
            with self.assertRaisesRegex(ValueError, "regular file"):
                MODULE.prepare_inputs(
                    contract_path=contract_path,
                    platform="linux",
                    source_installer=source,
                    candidate_installer=candidate,
                    output_dir=root / "symlink",
                )


if __name__ == "__main__":
    unittest.main()
