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
    MigrationRunError,
    ValidatedInputs,
    _assert_exact_windows_candidate_install_inventory,
    _assert_migration_state,
    _assert_reversible_directory_rename,
    _assert_source_readiness,
    _bounded_migration_state,
    _bounded_windows_install_inventory,
    _clear_qualification_roots,
    _windows_install_diagnostics,
    ReadinessFailed,
    ProbeShutdownError,
    SourceReadinessSpec,
    main,
    migration_matrix,
    run_matrix,
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

    def test_windows_updater_command_contract_is_lock_and_config_bound(self):
        repository_root = Path(__file__).resolve().parents[2]
        cargo_lock = (repository_root / "src-tauri/Cargo.lock").read_text(
            encoding="utf-8"
        )
        self.assertRegex(
            cargo_lock,
            r'(?ms)^\[\[package\]\]\nname = "tauri-plugin-updater"\n'
            r'version = "2\.9\.0"\n',
        )
        tauri_config = json.loads(
            (repository_root / "src-tauri/tauri.conf.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(
            tauri_config["plugins"]["updater"]["windows"]["installMode"],
            "passive",
        )

    def test_complete_installers_and_snapshots_validate(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            installers, manifest = self.make_inputs(Path(directory))
            validated = validate_inputs(installers, manifest, "linux")
            self.assertEqual(set(validated.installers), set(PHASES))
            self.assertEqual(set(validated.snapshots), {"current", "a", "b", "fresh"})

    def test_qualified_lane_metadata_binds_the_real_install_mode(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            installers, manifest = self.make_inputs(root)
            payload = json.loads(manifest.read_text(encoding="utf-8"))
            payload.update(
                {
                    "platform": "windows",
                    "lane": "legacy-auto-to-c-windows",
                    "scenario": "legacy-auto-to-c",
                    "qualificationMode": "automatic-updater",
                }
            )
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            cases = select_migration_cases(["legacy-auto-to-c"])

            validated = validate_inputs(
                installers,
                manifest,
                "windows",
                cases,
            )
            self.assertEqual(
                validated.qualification_mode,
                "automatic-updater",
            )

            payload["qualificationMode"] = "manual-installer"
            manifest.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(
                ValueError,
                "qualificationMode",
            ):
                validate_inputs(installers, manifest, "windows", cases)

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
                                "mobile_db_v1",
                                "assistant_ids_v1",
                                "mcp_names_v1",
                                "extensions_manifest_v1",
                                "cli_v1",
                                "assistant_db_refs_v1",
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

    def test_failed_reviewed_step_is_terminal_and_report_is_bounded(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            state = Path(directory) / "migration-state.json"
            state.write_text(
                json.dumps(
                    {
                        "data_schema": 0,
                        "steps": {
                            "extensions_manifest_v1": {
                                "status": "failed",
                                "error_code": "extension_id_not_allowed",
                                "message": "secret user message",
                                "path": "C:/Users/private/AppData/Roaming/Biyan",
                                "manifest_digest": "deadbeef",
                            },
                            "unreviewed_step": {
                                "status": "failed",
                                "error_code": "private",
                            },
                        },
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(
                ReadinessFailed,
                "extensions_manifest_v1/extension_id_not_allowed",
            ):
                _assert_migration_state(state, "current-to-c", "c")

            reviewed = _bounded_migration_state(state)
            encoded = json.dumps(reviewed)
            self.assertEqual(set(reviewed["steps"]), {
                "layout_v1",
                "assistant_ids_v1",
                "mcp_names_v1",
                "extensions_manifest_v1",
                "mobile_db_v1",
                "cli_v1",
                "assistant_db_refs_v1",
                "remote_only_v2",
                "cleanup_v3",
            })
            self.assertIn("extension_id_not_allowed", encoded)
            for forbidden in (
                "secret user message",
                "C:/Users/private",
                "deadbeef",
                "unreviewed_step",
            ):
                self.assertNotIn(forbidden, encoded)

    def test_migration_state_rejects_symlink_and_oversize_before_reading(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            target = root / "target.json"
            target.write_text('{"data_schema":3}', encoding="utf-8")
            link = root / "migration-state.json"
            link.symlink_to(target)
            self.assertEqual(
                _bounded_migration_state(link)["readStatus"],
                "symlink-rejected",
            )
            with self.assertRaisesRegex(ReadinessFailed, "bounded regular file"):
                _assert_migration_state(link, "current-to-c", "c")

            link.unlink()
            link.write_bytes(b" " * (64 * 1024 + 1))
            self.assertEqual(
                _bounded_migration_state(link)["readStatus"],
                "oversize-rejected",
            )

    def test_source_readiness_requires_exact_reviewed_files(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            data = root / "Biyan/data"
            data.mkdir(parents=True)
            settings = root / "Mita/settings.json"
            settings.parent.mkdir()
            store = data / "store.json"
            mcp = data / "mcp_config.json"
            marker = data / "agent-workspaces/direct-qualification-preserved.txt"
            marker.parent.mkdir()
            settings.write_text(
                json.dumps({"data_folder": str(data)}),
                encoding="utf-8",
            )
            store.write_text(
                json.dumps(
                    {
                        "version": "0.6.633",
                        "mcp_version": 5,
                        "windows_biyan_migrated": True,
                    }
                ),
                encoding="utf-8",
            )
            mcp.write_text('{"mcpServers":{}}', encoding="utf-8")
            marker.write_text("preserved", encoding="utf-8")
            spec = SourceReadinessSpec(
                "current",
                "0.6.633",
                settings,
                data,
                store,
                mcp,
                marker,
                {
                    "version": "0.6.633",
                    "mcp_version": 5,
                    "windows_biyan_migrated": True,
                },
            )
            self.assertEqual(len(_assert_source_readiness(spec)), 64)

            store.write_text(
                json.dumps(
                    {
                        "version": "0.6.633",
                        "mcp_version": 5,
                        "windows_biyan_migrated": 1,
                    }
                ),
                encoding="utf-8",
            )
            with self.assertRaisesRegex(RuntimeError, "windows_biyan_migrated"):
                _assert_source_readiness(spec)

    def test_windows_install_inventory_is_fixed_and_path_free(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            install = Path(directory) / "windows-install"
            package = (
                install
                / "resources/pre-install/biyan-assistant-extension-1.0.2.tgz"
            )
            package.parent.mkdir(parents=True)
            package.write_bytes(b"reviewed package")
            secret = Path(directory) / "secret.txt"
            secret.write_text("do not hash through links", encoding="utf-8")
            (install / "Biyan.exe").symlink_to(secret)
            oversized = (
                install
                / "resources/pre-install/biyan-download-extension-1.0.0.tgz"
            )
            with oversized.open("wb") as stream:
                stream.truncate(512 * 1024 * 1024 + 1)
            inventory = _bounded_windows_install_inventory(install)
            encoded = json.dumps(inventory)
            self.assertEqual(
                inventory["assistantExtension"]["sha256"],
                hashlib.sha256(b"reviewed package").hexdigest(),
            )
            self.assertEqual(
                inventory["biyanExecutable"]["kind"],
                "reparse-rejected",
            )
            self.assertEqual(
                inventory["downloadExtension"]["kind"],
                "oversize-rejected",
            )
            self.assertEqual(
                inventory["retiredAssistantExtension"]["kind"],
                "missing",
            )
            self.assertNotIn(str(install), encoded)

    def test_windows_candidate_install_inventory_is_exact_and_fail_closed(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            install = Path(directory) / "windows-install"
            pre_install = install / "resources/pre-install"
            pre_install.mkdir(parents=True)
            (install / "Biyan.exe").write_bytes(b"candidate")
            current = (
                "biyan-assistant-extension-1.0.2.tgz",
                "biyan-conversational-extension-1.0.0.tgz",
                "biyan-download-extension-1.0.0.tgz",
            )
            retired = (
                "janhq-assistant-extension-1.0.2.tgz",
                "janhq-conversational-extension-1.0.0.tgz",
                "janhq-download-extension-1.0.0.tgz",
                "janhq-llamacpp-extension-1.0.1.tgz",
                "janhq-rag-extension-0.1.0.tgz",
                "janhq-vector-db-extension-0.1.0.tgz",
            )
            for name in current:
                (pre_install / name).write_bytes(b"reviewed")

            _assert_exact_windows_candidate_install_inventory(install)

            for name in retired:
                with self.subTest(retired=name):
                    path = pre_install / name
                    path.write_bytes(b"retired")
                    with self.assertRaisesRegex(
                        ReadinessFailed,
                        "candidate_install_inventory",
                    ):
                        _assert_exact_windows_candidate_install_inventory(install)
                    path.unlink()

            for name in current:
                with self.subTest(missing=name):
                    path = pre_install / name
                    contents = path.read_bytes()
                    path.unlink()
                    with self.assertRaisesRegex(
                        ReadinessFailed,
                        "candidate_install_inventory",
                    ):
                        _assert_exact_windows_candidate_install_inventory(install)
                    path.write_bytes(contents)

            extra = pre_install / "unknown.tgz"
            extra.write_bytes(b"unknown")
            with self.assertRaisesRegex(
                ReadinessFailed,
                "candidate_install_inventory",
            ):
                _assert_exact_windows_candidate_install_inventory(install)
            extra.unlink()

            target = Path(directory) / "target.tgz"
            target.write_bytes(b"linked")
            linked = pre_install / current[0]
            linked.unlink()
            linked.symlink_to(target)
            with self.assertRaisesRegex(
                ReadinessFailed,
                "candidate_install_inventory",
            ):
                _assert_exact_windows_candidate_install_inventory(install)

    def test_source_data_root_rename_probe_is_reversible_and_conflict_closed(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            data = Path(directory) / "data"
            data.mkdir()
            marker = data / "marker.txt"
            marker.write_text("preserved", encoding="utf-8")
            _assert_reversible_directory_rename(data)
            self.assertEqual(marker.read_text(encoding="utf-8"), "preserved")

            conflict = data.parent / ".data.biyan-legacy-backup"
            conflict.mkdir()
            with self.assertRaisesRegex(ReadinessFailed, "conflict"):
                _assert_reversible_directory_rename(data)

    def test_windows_residual_process_check_is_bounded_and_fail_closed(self):
        executor = PlatformExecutor("windows", 1)
        executor.reset_case_evidence()
        with mock.patch(
            "autoqa.migration_runner.subprocess.run",
            return_value=mock.Mock(returncode=0, stdout="0\n"),
        ):
            executor.assert_no_residual_product_processes(Path("C:/AutoQA/install"))
        self.assertEqual(executor.source_guards["residualProcesses"], "clear")

        with (
            mock.patch(
                "autoqa.migration_runner.subprocess.run",
                return_value=mock.Mock(returncode=0, stdout="2\n"),
            ),
            self.assertRaisesRegex(ReadinessFailed, "source_residual_processes"),
        ):
            executor.assert_no_residual_product_processes(Path("C:/AutoQA/install"))

    def test_windows_cleanup_removes_only_reviewed_product_registry_keys(self):
        with (
            mock.patch(
                "autoqa.migration_runner.subprocess.run",
                return_value=mock.Mock(returncode=0),
            ) as run,
            mock.patch("autoqa.migration_runner.shutil.rmtree"),
        ):
            PlatformExecutor("windows", 1).cleanup_installation()

        self.assertEqual(run.call_count, 2)
        registry_call = run.call_args_list[1]
        self.assertTrue(registry_call.kwargs["check"])
        script = registry_call.args[0][-1]
        for product in ("Biyan", "Biyan-nightly", "Mita"):
            self.assertIn(f"Jingxing\\{product}", script)
            self.assertIn(f"Uninstall\\{product}", script)
        self.assertNotIn("HKLM:", script)
        self.assertIn("Test-Path -LiteralPath", script)
        self.assertIn("throw 'Reviewed product registry cleanup failed'", script)

    def test_probe_and_shutdown_failures_remain_distinct(self):
        process = mock.Mock(pid=1111)
        process.poll.return_value = None
        executor = PlatformExecutor("linux", 1)
        with (
            mock.patch(
                "autoqa.migration_runner.subprocess.Popen",
                return_value=process,
            ),
            mock.patch("autoqa.migration_runner.time.sleep"),
            mock.patch(
                "autoqa.migration_runner.time.monotonic",
                return_value=0.0,
            ),
            mock.patch.object(
                executor,
                "_terminate_process_tree",
                side_effect=RuntimeError("shutdown"),
            ),
            self.assertRaises(ProbeShutdownError) as raised,
        ):
            executor.startup_probe(
                Path("/tmp/Biyan.AppImage"),
                "current-to-c",
                "c",
                mock.Mock(side_effect=ReadinessFailed("migration step failed")),
            )
        self.assertIsInstance(raised.exception.probe_error, ReadinessFailed)
        self.assertIsInstance(raised.exception.shutdown_error, RuntimeError)

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

    def test_windows_manual_and_updater_install_commands_are_exact(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            case_dir = root / "case"
            installer = root / "Biyan-setup.exe"
            installer.write_bytes(b"fixture")

            def install_side_effect(command, **_kwargs):
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
                candidate = executor.install(
                    installer,
                    "c",
                    case_dir,
                    updater_install=True,
                )

            self.assertEqual(source, case_dir / "windows-install" / "Biyan.exe")
            self.assertEqual(candidate, source)
            self.assertEqual(run.call_count, 2)
            manual = run.call_args_list[0].args[0]
            updater = run.call_args_list[1].args[0]
            self.assertEqual(manual[1], "/S")
            self.assertEqual(manual[-1], f"/D={case_dir / 'windows-install'}")
            self.assertEqual(
                updater,
                [str(installer), "/P", "/UPDATE", "/ARGS"],
            )
            self.assertNotIn("/R", updater)
            self.assertFalse(any(argument.startswith("/D=") for argument in updater))

    def test_legacy_automatic_upgrade_uses_the_exact_default_biyan_root(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            case_dir = root / "case"
            installer = root / "Biyan-setup.exe"
            installer.write_bytes(b"fixture")
            default_root = root / "local" / "Programs" / "Biyan"

            def install_side_effect(command, **_kwargs):
                self.assertEqual(
                    command,
                    [str(installer), "/P", "/UPDATE", "/ARGS"],
                )
                executable = default_root / "Biyan.exe"
                executable.parent.mkdir(parents=True, exist_ok=True)
                executable.write_bytes(b"fixture executable")
                executable.chmod(0o755)
                return mock.Mock(returncode=0)

            with (
                mock.patch.dict(
                    os.environ,
                    {"LOCALAPPDATA": str(root / "local")},
                    clear=False,
                ),
                mock.patch(
                    "autoqa.migration_runner.subprocess.run",
                    side_effect=install_side_effect,
                ),
            ):
                executable = PlatformExecutor("windows", 1).install(
                    installer,
                    "c",
                    case_dir,
                    updater_install=True,
                    default_biyan_root=True,
                )
            self.assertEqual(executable, default_root / "Biyan.exe")

    def test_candidate_inventory_failure_blocks_first_start_and_is_classified(self):
        with tempfile.TemporaryDirectory(dir=Path.home()) as directory:
            root = Path(directory)
            case = select_migration_cases(["fresh-c"])[0]
            executable = root / "windows-install" / "Biyan.exe"
            validated = ValidatedInputs(
                installers={"c": root / "candidate.exe"},
                snapshots={"fresh": mock.Mock()},
                expectations={"c": (root / "migration-state.json",)},
            )
            with (
                mock.patch.object(
                    PlatformExecutor,
                    "cleanup_installation",
                ),
                mock.patch.object(
                    PlatformExecutor,
                    "install",
                    return_value=executable,
                ),
                mock.patch.object(
                    PlatformExecutor,
                    "startup_probe",
                ) as startup,
                mock.patch(
                    "autoqa.migration_runner._restore_snapshot",
                ),
                mock.patch(
                    "autoqa.migration_runner._clear_qualification_roots",
                ),
                mock.patch(
                    "autoqa.migration_runner._bounded_migration_state",
                    return_value={},
                ),
                mock.patch(
                    "autoqa.migration_runner._bounded_windows_install_inventory",
                    return_value={},
                ),
                mock.patch(
                    "autoqa.migration_runner."
                    "_assert_exact_windows_candidate_install_inventory",
                    side_effect=ReadinessFailed(
                        "candidate_install_inventory_extension_set"
                    ),
                ),
                self.assertRaises(MigrationRunError) as raised,
            ):
                run_matrix(
                    validated,
                    "windows",
                    root,
                    1,
                    cases=[case],
                )

            startup.assert_not_called()
            self.assertEqual(
                raised.exception.diagnostics["phaseBoundary"],
                "candidate-install-inventory",
            )
            self.assertEqual(
                raised.exception.diagnostics["failureClass"],
                "candidate-install-inventory-failed",
            )

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
