import hashlib
import json
import os
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from autoqa.migration_runner import (
    PHASES,
    PlatformExecutor,
    _assert_migration_state,
    _clear_qualification_roots,
    _windows_install_diagnostics,
    main,
    migration_matrix,
    select_migration_cases,
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
                "current-to-a",
                "a-to-b",
                "current-to-a-to-b-to-c",
                "current-to-b",
                "legacy-manual-to-c",
                "legacy-auto-to-c",
                "current-to-c",
                "a-to-c",
                "b-to-c",
                "c-to-c",
                "fresh-a",
                "fresh-c",
            ],
        )

    def test_complete_installers_and_snapshots_validate(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            installers, manifest = self.make_inputs(Path(directory))
            validated = validate_inputs(installers, manifest, "linux")
            self.assertEqual(set(validated.installers), set(PHASES))
            self.assertEqual(set(validated.snapshots), {"current", "a", "b", "fresh"})

    def test_current_to_a_requires_only_current_and_a_inputs(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            installers, manifest = self.make_inputs(root)
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            for phase in ("b", "c"):
                installers.pop(phase).unlink()
                del payload["installers"][phase]
                del payload["expectations"][phase]
            for snapshot in ("a", "b", "fresh"):
                (root / f"{snapshot}.zip").unlink()
                del payload["snapshots"][snapshot]
            manifest.write_text(json.dumps(payload), encoding="utf-8")

            cases = select_migration_cases(["current-to-a"])
            validated = validate_inputs(installers, manifest, "linux", cases)

            self.assertEqual(set(validated.installers), {"current", "a"})
            self.assertEqual(set(validated.snapshots), {"current"})
            self.assertEqual(set(validated.expectations), {"a"})

    def test_fresh_a_requires_only_a_installer_and_fresh_snapshot(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            installers, manifest = self.make_inputs(root)
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            for phase in ("current", "b", "c"):
                installers.pop(phase).unlink()
                del payload["installers"][phase]
                if phase in payload["expectations"]:
                    del payload["expectations"][phase]
            for snapshot in ("current", "a", "b"):
                (root / f"{snapshot}.zip").unlink()
                del payload["snapshots"][snapshot]
            manifest.write_text(json.dumps(payload), encoding="utf-8")

            cases = select_migration_cases(["fresh-a"])
            validated = validate_inputs(installers, manifest, "linux", cases)

            self.assertEqual(set(validated.installers), {"a"})
            self.assertEqual(set(validated.snapshots), {"fresh"})
            self.assertEqual(set(validated.expectations), {"a"})

    def test_unknown_scenario_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "unknown migration scenario"):
            select_migration_cases(["not-a-scenario"])

    def test_duplicate_scenario_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "duplicate migration scenario"):
            select_migration_cases(["fresh-a", "fresh-a"])

    def test_selected_scenario_missing_dependency_fails_closed(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            installers, manifest = self.make_inputs(root)
            cases = select_migration_cases(["current-to-a"])

            installers["a"].unlink()
            with self.assertRaisesRegex(FileNotFoundError, "a installer"):
                validate_inputs(installers, manifest, "linux", cases)

            installers["a"].write_bytes(b"installer-a")
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            del payload["snapshots"]["current"]
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(FileNotFoundError, "current"):
                validate_inputs(installers, manifest, "linux", cases)

    def test_focused_validate_report_identifies_scenario_platform_and_status(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            installers, manifest = self.make_inputs(root)
            report = root / "report.json"

            result = main(
                [
                    "--platform",
                    "linux",
                    "--current-installer",
                    str(installers["current"]),
                    "--a-installer",
                    str(installers["a"]),
                    "--scenario",
                    "current-to-a",
                    "--snapshot-manifest",
                    str(manifest),
                    "--report",
                    str(report),
                    "--validate-only",
                ]
            )

            self.assertEqual(result, 0)
            payload = json.loads(report.read_text(encoding="utf-8"))
            self.assertEqual(payload["scenarios"], ["current-to-a"])
            self.assertEqual(
                {
                    "scenario": payload["matrix"][0]["scenario"],
                    "platform": payload["matrix"][0]["platform"],
                    "status": payload["matrix"][0]["status"],
                },
                {
                    "scenario": "current-to-a",
                    "platform": "linux",
                    "status": "validated",
                },
            )

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

    def test_unix_cleanup_never_matches_the_runner_command_line(self):
        runner_command = (
            "python autoqa/migration_runner.py --a-installer "
            "/tmp/Biyan_0.6.643_amd64.AppImage"
        )
        self.assertIn("Biyan", runner_command)

        for platform in ("macos", "linux"):
            with self.subTest(platform=platform):
                with (
                    mock.patch(
                        "autoqa.migration_runner.subprocess.run"
                    ) as run,
                    mock.patch("autoqa.migration_runner.shutil.rmtree"),
                ):
                    PlatformExecutor(platform, 1).cleanup_installation()

                pkill_commands = [
                    call.args[0]
                    for call in run.call_args_list
                    if call.args and call.args[0][0] == "pkill"
                ]
                self.assertGreater(len(pkill_commands), 0)
                self.assertTrue(
                    all(command[1] == "-x" for command in pkill_commands)
                )
                self.assertTrue(
                    all("-f" not in command for command in pkill_commands)
                )
                self.assertTrue(
                    all(runner_command not in command for command in pkill_commands)
                )

    def test_windows_install_pins_shared_root_and_keeps_nsis_destination_last(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            case_dir = root / "case"
            installer = root / "Biyan-setup.exe"
            installer.write_bytes(b"fixture")

            def install_side_effect(command, **_kwargs):
                self.assertEqual(command[-1], f"/D={case_dir / 'windows-install'}")
                executable = case_dir / "windows-install" / "Biyan.exe"
                executable.parent.mkdir(parents=True, exist_ok=True)
                executable.write_bytes(b"fixture executable")
                executable.chmod(0o755)
                return mock.Mock(returncode=0)

            with mock.patch(
                "autoqa.migration_runner.subprocess.run",
                side_effect=install_side_effect,
            ) as run:
                executor = PlatformExecutor("windows", 1)
                source = executor.install(installer, "current", case_dir)
                candidate = executor.install(installer, "c", case_dir)

            self.assertEqual(source, case_dir / "windows-install" / "Biyan.exe")
            self.assertEqual(candidate, source)
            self.assertEqual(run.call_count, 2)
            for call in run.call_args_list:
                command = call.args[0]
                self.assertEqual(command[1], "/S")
                self.assertEqual(command[-1], f"/D={case_dir / 'windows-install'}")

    def test_windows_missing_executable_reports_bounded_install_roots(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            case_dir = root / "case"
            installer = root / "Biyan-setup.exe"
            installer.write_bytes(b"fixture")

            with mock.patch("autoqa.migration_runner.subprocess.run"):
                with self.assertRaisesRegex(
                    FileNotFoundError,
                    r'diagnostics=.*"schema": 1',
                ):
                    PlatformExecutor("windows", 1).install(
                        installer,
                        "c",
                        case_dir,
                    )

    def test_windows_diagnostics_capture_only_bounded_install_and_security_state(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            install_root = Path(directory) / "windows-install"
            install_root.mkdir()
            (install_root / "Biyan.exe").write_bytes(b"fixture")
            system_payload = {
                "uninstall": [
                    {
                        "DisplayName": "Biyan",
                        "DisplayVersion": "0.6.633",
                        "InstallLocation": str(install_root),
                    }
                ],
                "defender": {
                    "AMServiceEnabled": True,
                    "AntivirusEnabled": True,
                    "RealTimeProtectionEnabled": True,
                },
            }
            completed = mock.Mock(
                returncode=0,
                stdout=json.dumps(system_payload),
                stderr="",
            )
            with (
                mock.patch("autoqa.migration_runner.sys.platform", "win32"),
                mock.patch(
                    "autoqa.migration_runner.subprocess.run",
                    return_value=completed,
                ) as run,
            ):
                diagnostics = _windows_install_diagnostics(install_root)

            self.assertEqual(diagnostics["schema"], 1)
            self.assertEqual(diagnostics["system"]["status"], "captured")
            self.assertEqual(diagnostics["system"]["data"], system_payload)
            command = run.call_args.args[0]
            self.assertEqual(command[:3], ["powershell", "-NoProfile", "-NonInteractive"])
            self.assertNotIn("Get-ChildItem Env:", command[-1])

    def test_startup_probe_scrubs_ci_and_cloud_credentials(self):
        injected = {
            "GH_TOKEN": "github",
            "GITHUB_TOKEN": "github",
            "ACTIONS_ID_TOKEN_REQUEST_TOKEN": "oidc",
            "AWS_SECRET_ACCESS_KEY": "aws",
            "ALIYUN_ACCESS_KEY_SECRET": "aliyun",
            "CLOUDFLARE_API_TOKEN": "cloudflare",
            "BIYAN_SIGNING_KEY": "biyan",
            "TAURI_SIGNING_PRIVATE_KEY": "tauri",
            "CUSTOM_PASSWORD": "password",
            "CUSTOM_PRIVATE_KEY": "private-key",
            "PATH": os.environ.get("PATH", ""),
            "HOME": str(Path.home()),
        }
        process = mock.Mock()
        process.pid = 4242
        process.poll.return_value = None
        with (
            mock.patch.dict(os.environ, injected, clear=True),
            mock.patch(
                "autoqa.migration_runner.subprocess.Popen",
                return_value=process,
            ) as popen,
            mock.patch("autoqa.migration_runner.time.sleep"),
            mock.patch("autoqa.migration_runner.os.killpg") as killpg,
        ):
            PlatformExecutor("linux", 1).startup_probe(
                Path("/tmp/Biyan.AppImage"),
                "fresh-a",
                "a",
            )

        child_env = popen.call_args.kwargs["env"]
        for name in injected:
            if name not in {"PATH", "HOME"}:
                self.assertNotIn(name, child_env)
        self.assertEqual(
            child_env["BIYAN_AUTOQA_MIGRATION_SCENARIO"],
            "fresh-a",
        )
        self.assertEqual(child_env["BIYAN_AUTOQA_MIGRATION_PHASE"], "a")
        self.assertTrue(popen.call_args.kwargs["start_new_session"])
        self.assertEqual(
            [call.args for call in killpg.call_args_list],
            [(4242, 15), (4242, 9)],
        )

    def test_migration_readiness_polls_until_complete(self):
        process = mock.Mock(pid=5151)
        process.poll.return_value = None
        readiness = mock.Mock(
            side_effect=[
                FileNotFoundError("state missing"),
                RuntimeError("schema is still zero"),
                None,
            ]
        )
        with (
            mock.patch(
                "autoqa.migration_runner.subprocess.Popen",
                return_value=process,
            ),
            mock.patch("autoqa.migration_runner.time.sleep") as sleep,
            mock.patch(
                "autoqa.migration_runner.time.monotonic",
                side_effect=[0.0, 1.0, 2.0],
            ),
            mock.patch("autoqa.migration_runner.os.killpg"),
        ):
            PlatformExecutor("linux", 1, 90).startup_probe(
                Path("/tmp/Biyan.AppImage"),
                "current-to-c",
                "c",
                readiness,
            )

        self.assertEqual(readiness.call_count, 3)
        self.assertEqual(sleep.call_args_list[0], mock.call(1))
        self.assertEqual(sleep.call_args_list[1:], [mock.call(1.0), mock.call(1.0)])

    def test_migration_readiness_timeout_and_early_exit_fail_closed(self):
        timeout_process = mock.Mock(pid=6161)
        timeout_process.poll.return_value = None
        with (
            mock.patch(
                "autoqa.migration_runner.subprocess.Popen",
                return_value=timeout_process,
            ),
            mock.patch("autoqa.migration_runner.time.sleep"),
            mock.patch(
                "autoqa.migration_runner.time.monotonic",
                side_effect=[0.0, 90.0],
            ),
            mock.patch("autoqa.migration_runner.os.killpg"),
        ):
            with self.assertRaisesRegex(RuntimeError, "timed out after 90s"):
                PlatformExecutor("linux", 1, 90).startup_probe(
                    Path("/tmp/Biyan.AppImage"),
                    "current-to-c",
                    "c",
                    mock.Mock(side_effect=FileNotFoundError("state missing")),
                )

        exit_process = mock.Mock(pid=7171)
        exit_process.poll.return_value = 7
        with (
            mock.patch(
                "autoqa.migration_runner.subprocess.Popen",
                return_value=exit_process,
            ),
            mock.patch("autoqa.migration_runner.time.sleep"),
            mock.patch("autoqa.migration_runner.time.monotonic", return_value=0.0),
            mock.patch("autoqa.migration_runner.os.killpg"),
        ):
            with self.assertRaisesRegex(RuntimeError, "exited early"):
                PlatformExecutor("linux", 1, 90).startup_probe(
                    Path("/tmp/Biyan.AppImage"),
                    "current-to-c",
                    "c",
                    mock.Mock(),
                )

    def test_windows_process_tree_is_force_terminated(self):
        process = mock.Mock(pid=8181)
        with mock.patch(
            "autoqa.migration_runner.subprocess.run",
            return_value=mock.Mock(returncode=0),
        ) as run:
            PlatformExecutor("windows", 1, 90)._terminate_process_tree(process)

        self.assertEqual(
            run.call_args.args[0],
            ["taskkill", "/PID", "8181", "/T", "/F"],
        )
        self.assertEqual(run.call_args.kwargs["timeout"], 30)

    def test_windows_process_tree_failure_is_fail_closed(self):
        process = mock.Mock(pid=9191)
        with (
            mock.patch(
                "autoqa.migration_runner.subprocess.run",
                return_value=mock.Mock(returncode=5),
            ),
            self.assertRaisesRegex(RuntimeError, "taskkill exit 5"),
        ):
            PlatformExecutor("windows", 1, 90)._terminate_process_tree(process)

    def test_cleanup_never_derives_delete_root_from_expectations(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            installers, manifest = self.make_inputs(root)
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            unexpected = root / "Documents/migration-state.json"
            payload["expectations"]["a"] = [str(unexpected)]
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            validated = validate_inputs(
                {"a": installers["a"]},
                manifest,
                "linux",
                select_migration_cases(["fresh-a"]),
            )

            with (
                mock.patch.dict(
                    os.environ,
                    {"XDG_DATA_HOME": str(root / "profile")},
                    clear=False,
                ),
                mock.patch("autoqa.migration_runner.shutil.rmtree") as rmtree,
            ):
                _clear_qualification_roots(validated, "linux")

            cleared = {call.args[0] for call in rmtree.call_args_list}
            self.assertNotIn(unexpected.parent, cleared)
            self.assertEqual(
                cleared,
                {
                    root / "profile/fresh",
                    root / "profile/Biyan",
                },
            )


if __name__ == "__main__":
    unittest.main()
