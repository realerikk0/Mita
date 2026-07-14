import hashlib
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from autoqa.migration_runner import (
    PHASES,
    _assert_migration_state,
    migration_matrix,
    validate_inputs,
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class MigrationRunnerTests(unittest.TestCase):
    def make_inputs(self, root: Path):
        installers = {}
        installer_manifest = {}
        for phase in PHASES:
            path = root / f"{phase}.installer"
            path.write_bytes(f"installer-{phase}".encode())
            installers[phase] = path
            installer_manifest[phase] = {"sha256": sha256(path)}

        snapshot_manifest = {}
        for name in ("current", "a", "b", "fresh"):
            archive = root / f"{name}.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr("marker.txt", name)
            snapshot_manifest[name] = {
                "archive": archive.name,
                "sha256": sha256(archive),
                "restore_to": str(root / "profile" / name),
            }

        manifest = root / "manifest.json"
        manifest.write_text(
            json.dumps(
                {
                    "schema": 1,
                    "sanitized": True,
                    "platform": "linux",
                    "installers": installer_manifest,
                    "snapshots": snapshot_manifest,
                    "expectations": {
                        "a": [str(root / "profile" / "expected-a")],
                        "b": [str(root / "profile" / "expected-b")],
                        "c": [str(root / "profile" / "expected-c")],
                    },
                }
            ),
            encoding="utf-8",
        )
        return installers, manifest

    def test_matrix_is_complete_and_explicit(self):
        self.assertEqual(
            [case.name for case in migration_matrix()],
            [
                "current-to-a-to-b-to-c",
                "current-to-b",
                "current-to-c",
                "a-to-c",
                "b-to-c",
                "fresh-c",
            ],
        )

    def test_complete_installers_and_snapshots_validate(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            installers, manifest = self.make_inputs(Path(directory))
            validated = validate_inputs(installers, manifest, "linux")
            self.assertEqual(set(validated.installers), set(PHASES))
            self.assertEqual(set(validated.snapshots), {"current", "a", "b", "fresh"})

    def test_missing_installer_fails_closed(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            installers, manifest = self.make_inputs(Path(directory))
            installers["b"].unlink()
            with self.assertRaisesRegex(FileNotFoundError, "b installer"):
                validate_inputs(installers, manifest, "linux")

    def test_missing_installer_argument_fails_closed(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            installers, manifest = self.make_inputs(Path(directory))
            del installers["c"]
            with self.assertRaisesRegex(FileNotFoundError, "phase c"):
                validate_inputs(installers, manifest, "linux")

    def test_missing_snapshot_fails_closed(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            installers, manifest = self.make_inputs(Path(directory))
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            del payload["snapshots"]["fresh"]
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(FileNotFoundError, "fresh"):
                validate_inputs(installers, manifest, "linux")

    def test_unsanitized_snapshot_bundle_is_rejected(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            installers, manifest = self.make_inputs(Path(directory))
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            payload["sanitized"] = False
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "sanitized=true"):
                validate_inputs(installers, manifest, "linux")

    def test_snapshot_archive_may_not_escape_bundle(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            installers, manifest = self.make_inputs(root)
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            payload["snapshots"]["current"]["archive"] = "../outside.zip"
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "escapes the signed bundle"):
                validate_inputs(installers, manifest, "linux")

    def test_migration_state_requires_exact_schema_and_completed_steps(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            state = Path(directory) / "migration-state.json"
            state.write_text(
                json.dumps(
                    {
                        "data_schema": 3,
                        "steps": {
                            name: {"status": "completed"}
                            for name in (
                                "layout_v1",
                                "assistant_ids_v1",
                                "mcp_names_v1",
                                "extensions_manifest_v1",
                                "remote_only_v2",
                                "cleanup_v3",
                            )
                        },
                    }
                ),
                encoding="utf-8",
            )
            _assert_migration_state(state, "current-to-c", "c")
            with self.assertRaisesRegex(RuntimeError, "schema mismatch"):
                _assert_migration_state(state, "current-to-b", "b")

            payload = json.loads(state.read_text(encoding="utf-8"))
            payload["steps"]["cleanup_v3"]["status"] = "pending"
            state.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "cleanup_v3"):
                _assert_migration_state(state, "current-to-c", "c")


if __name__ == "__main__":
    unittest.main()
