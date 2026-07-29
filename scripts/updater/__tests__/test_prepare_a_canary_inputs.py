import hashlib
import importlib.util
import json
import tempfile
import unittest
import zipfile
from pathlib import Path


MODULE_PATH = Path(__file__).parents[1] / "prepare-a-canary-inputs.py"
SPEC = importlib.util.spec_from_file_location("prepare_a_canary_inputs", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class PrepareACanaryInputsTests(unittest.TestCase):
    def make_policy(self, root: Path) -> tuple[Path, dict]:
        current = root / "Biyan_0.6.633_x64-setup.exe"
        candidate = root / "Biyan_0.6.643_x64-setup.exe"
        linux = root / "Biyan_0.6.643_amd64.AppImage"
        current.write_bytes(b"current")
        candidate.write_bytes(b"candidate")
        linux.write_bytes(b"linux-candidate")
        manifest_sha = "1" * 64
        policy = {
            "schema": 1,
            "workflow": {
                "path": ".github/workflows/biyan-a-canary.yml",
                "name": "Biyan A Canary",
                "minimumHours": 48,
            },
            "current": {
                "version": "0.6.633",
                "tag": "v0.6.633",
                "sourceCommit": "2" * 40,
                "manifestSha256": manifest_sha,
            },
            "candidate": {
                "version": "0.6.643",
                "tag": "v0.6.643",
                "sourceCommit": "3" * 40,
                "manifestSha256": "4" * 64,
            },
            "platforms": {
                "windows": {
                    "scenario": "current-to-a",
                    "currentAsset": {"name": current.name, "sha256": digest(current)},
                    "candidateAsset": {
                        "name": candidate.name,
                        "sha256": digest(candidate),
                    },
                },
                "macos": {
                    "scenario": "current-to-a",
                    "currentAsset": {
                        "name": "Biyan_0.6.633_universal.dmg",
                        "sha256": "5" * 64,
                    },
                    "candidateAsset": {
                        "name": "Biyan_0.6.643_universal.dmg",
                        "sha256": "6" * 64,
                    },
                },
                "linux": {
                    "scenario": "fresh-a",
                    "compatibilityException": {
                        "code": "no-production-current-linux-artifact",
                        "currentVersion": "0.6.633",
                        "currentManifestSha256": manifest_sha,
                    },
                    "candidateAsset": {
                        "name": linux.name,
                        "sha256": digest(linux),
                    },
                },
            },
        }
        policy_path = root / "policy.json"
        policy_path.write_text(json.dumps(policy), encoding="utf-8")
        return policy_path, policy

    def test_windows_current_to_a_is_minimal_and_sanitized(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy_path, policy = self.make_policy(root)
            output = root / "output"
            manifest = MODULE.prepare_inputs(
                policy_path=policy_path,
                platform="windows",
                current_installer=root
                / policy["platforms"]["windows"]["currentAsset"]["name"],
                candidate_installer=root
                / policy["platforms"]["windows"]["candidateAsset"]["name"],
                output_dir=output,
            )
            self.assertEqual(manifest["scenario"], "current-to-a")
            self.assertEqual(set(manifest["installers"]), {"current", "a"})
            self.assertEqual(set(manifest["snapshots"]), {"current"})
            with zipfile.ZipFile(output / "snapshots/current.zip") as archive:
                self.assertEqual(archive.namelist(), ["canary-preserved.txt"])
            self.assertIn(
                "%APPDATA%/Biyan/canary-preserved.txt",
                manifest["expectations"]["a"],
            )

    def test_linux_fresh_a_refuses_a_current_installer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy_path, policy = self.make_policy(root)
            linux = root / policy["platforms"]["linux"]["candidateAsset"]["name"]
            manifest = MODULE.prepare_inputs(
                policy_path=policy_path,
                platform="linux",
                current_installer=None,
                candidate_installer=linux,
                output_dir=root / "output",
            )
            self.assertEqual(manifest["scenario"], "fresh-a")
            self.assertEqual(set(manifest["installers"]), {"a"})
            self.assertEqual(set(manifest["snapshots"]), {"fresh"})
            with self.assertRaisesRegex(ValueError, "must not accept"):
                MODULE.prepare_inputs(
                    policy_path=policy_path,
                    platform="linux",
                    current_installer=linux,
                    candidate_installer=linux,
                    output_dir=root / "other",
                )

    def test_digest_mismatch_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            policy_path, policy = self.make_policy(root)
            candidate = root / policy["platforms"]["windows"]["candidateAsset"]["name"]
            candidate.write_bytes(b"tampered")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                MODULE.prepare_inputs(
                    policy_path=policy_path,
                    platform="windows",
                    current_installer=root
                    / policy["platforms"]["windows"]["currentAsset"]["name"],
                    candidate_installer=candidate,
                    output_dir=root / "output",
                )


if __name__ == "__main__":
    unittest.main()
