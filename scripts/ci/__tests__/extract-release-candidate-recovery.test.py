#!/usr/bin/env python3

import importlib.util
import io
import os
from pathlib import Path
import stat
import tempfile
import unittest
import warnings
import zipfile
from contextlib import redirect_stderr


SCRIPT = (
    Path(__file__).resolve().parents[1]
    / "extract-release-candidate-recovery.py"
)
SPEC = importlib.util.spec_from_file_location(
    "extract_release_candidate_recovery", SCRIPT
)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("could not load recovery extractor")
RECOVERY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECOVERY)

VERSION = "0.6.643"


def write_entry(
    archive: zipfile.ZipFile,
    name: str,
    content: bytes = b"candidate-bytes",
    kind: str = "file",
) -> None:
    info = zipfile.ZipInfo(name)
    info.create_system = 3
    if kind == "file":
        info.external_attr = (stat.S_IFREG | 0o600) << 16
    elif kind == "directory":
        info.external_attr = (stat.S_IFDIR | 0o700) << 16
    elif kind == "symlink":
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
    else:
        raise ValueError(f"unsupported test ZIP entry kind: {kind}")
    archive.writestr(info, content)


def write_entries(
    archive: zipfile.ZipFile,
    entries: list[tuple[str, bytes, str]],
) -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UserWarning)
        for name, content, kind in entries:
            write_entry(archive, name, content, kind)


def make_archives(
    root: Path,
    mutate=None,
) -> Path:
    archives = root / "archives"
    archives.mkdir()
    for artifact_name, (archive_file, expected_files) in (
        RECOVERY.expected_archives(VERSION).items()
    ):
        entries = [
            (name, b"candidate-bytes", "file")
            for name in sorted(expected_files)
        ]
        if mutate is not None:
            entries = mutate(artifact_name, entries)
        with zipfile.ZipFile(
            archives / archive_file,
            mode="w",
            compression=zipfile.ZIP_DEFLATED,
        ) as archive:
            write_entries(archive, entries)
    return archives


def make_updater_archive(
    root: Path,
    mutate=None,
) -> Path:
    archive_path = root / "updater.zip"
    entries = [
        (name, b"candidate-bytes", "file")
        for name in sorted(RECOVERY.expected_updater_files(VERSION))
    ]
    if mutate is not None:
        entries = mutate(entries)
    with zipfile.ZipFile(
        archive_path,
        mode="w",
        compression=zipfile.ZIP_DEFLATED,
    ) as archive:
        write_entries(archive, entries)
    return archive_path


class RecoveryExtractorTests(unittest.TestCase):
    def test_extracts_exact_nine_file_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archives = make_archives(root)
            output = root / "output"
            RECOVERY.extract_recovery_archives(archives, output, VERSION)
            files = sorted(
                path.relative_to(output).as_posix()
                for path in output.rglob("*")
                if path.is_file()
            )
            self.assertEqual(len(files), 9)
            self.assertTrue(
                all(
                    path.stat().st_size > 0
                    for path in output.rglob("*")
                    if path.is_file()
                )
            )
            self.assertTrue(
                all(
                    path.stat().st_mode & 0o777 == 0o600
                    for path in output.rglob("*")
                    if path.is_file()
                )
            )

    def test_cli_extracts_exact_platform_archives(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            archives = make_archives(root)
            output = root / "output"
            status = RECOVERY.main(
                [
                    "--archives-dir",
                    str(archives),
                    "--output-dir",
                    str(output),
                    "--version",
                    VERSION,
                ]
            )
            self.assertEqual(status, 0)
            self.assertEqual(
                len(
                    [
                        path
                        for path in output.rglob("*")
                        if path.is_file()
                    ]
                ),
                9,
            )

    def assert_rejected(self, mutate, pattern: str) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archives = make_archives(root, mutate)
            output = root / "output"
            with self.assertRaisesRegex(ValueError, pattern):
                RECOVERY.extract_recovery_archives(
                    archives, output, VERSION
                )
            self.assertFalse(output.exists())

    def test_rejects_extra_file(self) -> None:
        def mutate(artifact_name, entries):
            if artifact_name.startswith("biyan-linux"):
                return entries + [("extra.txt", b"extra", "file")]
            return entries

        self.assert_rejected(mutate, "unexpected ZIP file")

    def test_rejects_path_traversal(self) -> None:
        def mutate(artifact_name, entries):
            if artifact_name.startswith("biyan-linux"):
                return entries + [("../escape", b"escape", "file")]
            return entries

        self.assert_rejected(mutate, "unsafe ZIP entry")

    def test_rejects_every_noncanonical_member_name_form(self) -> None:
        names = [
            "./appimage/Biyan_0.6.643_amd64.AppImage",
            "appimage//Biyan_0.6.643_amd64.AppImage",
            "/appimage/Biyan_0.6.643_amd64.AppImage",
            r"appimage\Biyan_0.6.643_amd64.AppImage",
            "appimage/\x00Biyan_0.6.643_amd64.AppImage",
        ]
        for name in names:
            with self.subTest(name=repr(name)):
                with self.assertRaisesRegex(ValueError, "unsafe ZIP entry"):
                    RECOVERY.safe_member_name(name, "test-artifact")

    def test_rejects_noncanonical_member_that_normalizes_to_expected(self) -> None:
        for prefix in ("./", "appimage/../"):
            def mutate(artifact_name, entries, prefix=prefix):
                if artifact_name.startswith("biyan-linux"):
                    name, content, kind = entries[0]
                    name = f"{prefix}{name}"
                    return [(name, content, kind), *entries[1:]]
                return entries

            with self.subTest(prefix=prefix):
                self.assert_rejected(mutate, "unsafe ZIP entry")

    def test_rejects_symlink(self) -> None:
        def mutate(artifact_name, entries):
            if artifact_name.startswith("biyan-linux"):
                name, content, _ = entries[0]
                return [(name, content, "symlink"), *entries[1:]]
            return entries

        self.assert_rejected(mutate, "symlink ZIP entry")

    def test_rejects_empty_file(self) -> None:
        def mutate(artifact_name, entries):
            if artifact_name.startswith("biyan-linux"):
                name, _, kind = entries[0]
                return [(name, b"", kind), *entries[1:]]
            return entries

        self.assert_rejected(mutate, "empty ZIP file")

    def test_rejects_missing_file(self) -> None:
        def mutate(artifact_name, entries):
            if artifact_name.startswith("biyan-linux"):
                return entries[1:]
            return entries

        self.assert_rejected(mutate, "incomplete ZIP inventory")

    def test_rejects_duplicate_file(self) -> None:
        def mutate(artifact_name, entries):
            if artifact_name.startswith("biyan-linux"):
                return [entries[0], *entries]
            return entries

        self.assert_rejected(mutate, "duplicate ZIP file")

    def test_rejects_unexpected_zip_directory(self) -> None:
        def mutate(artifact_name, entries):
            if artifact_name.startswith("biyan-linux"):
                return [*entries, ("unexpected/", b"", "directory")]
            return entries

        self.assert_rejected(mutate, "unexpected ZIP directory")

    def test_rejects_unexpected_archive_and_existing_output(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archives = make_archives(root)
            (archives / "extra.zip").write_bytes(b"extra")
            with self.assertRaisesRegex(
                ValueError, "must contain exactly"
            ):
                RECOVERY.extract_recovery_archives(
                    archives, root / "output", VERSION
                )

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archives = make_archives(root)
            output = root / "output"
            output.mkdir()
            with self.assertRaisesRegex(
                ValueError, "already exists"
            ):
                RECOVERY.extract_recovery_archives(
                    archives, output, VERSION
                )

    def test_rejects_extra_archive_directory_and_symlink(self) -> None:
        for kind in ("directory", "symlink"):
            with self.subTest(kind=kind):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    archives = make_archives(root)
                    extra = archives / "extra.zip"
                    if kind == "directory":
                        extra.mkdir()
                    else:
                        try:
                            os.symlink("linux.zip", extra)
                        except OSError as error:
                            self.skipTest(
                                f"symlinks are unavailable: {error}"
                            )
                    with self.assertRaisesRegex(
                        ValueError,
                        "exactly three regular non-symlink ZIP files",
                    ):
                        RECOVERY.extract_recovery_archives(
                            archives,
                            root / "output",
                            VERSION,
                        )

    def test_rejects_expected_archive_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archives = make_archives(root)
            original = archives / "linux.zip"
            target = root / "linux.zip"
            original.replace(target)
            try:
                os.symlink(target, original)
            except OSError as error:
                self.skipTest(f"symlinks are unavailable: {error}")
            with self.assertRaisesRegex(
                ValueError,
                "exactly three regular non-symlink ZIP files",
            ):
                RECOVERY.extract_recovery_archives(
                    archives,
                    root / "output",
                    VERSION,
                )

    def test_rejects_noncanonical_version(self) -> None:
        with self.assertRaisesRegex(ValueError, "canonical"):
            RECOVERY.expected_archives("v0.6.643")
        with self.assertRaisesRegex(ValueError, "canonical"):
            RECOVERY.expected_updater_files("0.06.643")


class UpdaterArchiveExtractorTests(unittest.TestCase):
    def assert_rejected(self, mutate, pattern: str) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = make_updater_archive(root, mutate)
            output = root / "output"
            with self.assertRaisesRegex(ValueError, pattern):
                RECOVERY.extract_updater_archive(
                    archive,
                    output,
                    VERSION,
                )
            self.assertFalse(output.exists())

    def test_extracts_exact_flat_thirteen_file_inventory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = make_updater_archive(root)
            output = root / "output"
            RECOVERY.extract_updater_archive(archive, output, VERSION)

            files = sorted(path.name for path in output.iterdir())
            self.assertEqual(
                files,
                sorted(RECOVERY.expected_updater_files(VERSION)),
            )
            self.assertEqual(len(files), 13)
            self.assertTrue(
                all(path.is_file() for path in output.iterdir())
            )
            self.assertTrue(
                all(path.stat().st_size > 0 for path in output.iterdir())
            )
            self.assertTrue(
                all(
                    path.stat().st_mode & 0o777 == 0o600
                    for path in output.iterdir()
                )
            )

    def test_cli_extracts_updater_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            archive = make_updater_archive(root)
            output = root / "output"
            status = RECOVERY.main(
                [
                    "--updater-archive",
                    str(archive),
                    "--output-dir",
                    str(output),
                    "--version",
                    VERSION,
                ]
            )
            self.assertEqual(status, 0)
            self.assertEqual(
                {path.name for path in output.iterdir()},
                RECOVERY.expected_updater_files(VERSION),
            )

    def test_cli_rejects_symlink_updater_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            archive = make_updater_archive(root)
            symlink = root / "updater-link.zip"
            try:
                os.symlink(archive.name, symlink)
            except OSError as error:
                self.skipTest(f"symlinks are unavailable: {error}")
            output = root / "output"
            with redirect_stderr(io.StringIO()):
                status = RECOVERY.main(
                    [
                        "--updater-archive",
                        str(symlink),
                        "--output-dir",
                        str(output),
                        "--version",
                        VERSION,
                    ]
                )
            self.assertEqual(status, 1)
            self.assertFalse(output.exists())

    def test_cli_rejects_symlink_output_path(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            archive = make_updater_archive(root)
            output = root / "output-link"
            redirected = root / "redirected-output"
            try:
                os.symlink(redirected.name, output)
            except OSError as error:
                self.skipTest(f"symlinks are unavailable: {error}")
            with redirect_stderr(io.StringIO()):
                status = RECOVERY.main(
                    [
                        "--updater-archive",
                        str(archive),
                        "--output-dir",
                        str(output),
                        "--version",
                        VERSION,
                    ]
                )
            self.assertEqual(status, 1)
            self.assertFalse(redirected.exists())

    def test_cli_rejects_symlink_parent_components(self) -> None:
        for path_kind in ("input", "output"):
            with self.subTest(path_kind=path_kind):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary).resolve()
                    archive = make_updater_archive(root)
                    real_parent = root / f"real-{path_kind}-parent"
                    real_parent.mkdir()
                    linked_parent = root / f"linked-{path_kind}-parent"
                    try:
                        os.symlink(real_parent.name, linked_parent)
                    except OSError as error:
                        self.skipTest(
                            f"symlinks are unavailable: {error}"
                        )
                    if path_kind == "input":
                        archive = archive.replace(
                            real_parent / archive.name
                        )
                        archive_argument = linked_parent / archive.name
                        output = root / "output"
                    else:
                        archive_argument = archive
                        output = linked_parent / "output"
                    with redirect_stderr(io.StringIO()):
                        status = RECOVERY.main(
                            [
                                "--updater-archive",
                                str(archive_argument),
                                "--output-dir",
                                str(output),
                                "--version",
                                VERSION,
                            ]
                        )
                    self.assertEqual(status, 1)
                    self.assertFalse((real_parent / "output").exists())

    def test_rejects_extra_missing_duplicate_and_symlink_entries(self) -> None:
        cases = [
            (
                "extra",
                lambda entries: [
                    *entries,
                    ("extra.txt", b"extra", "file"),
                ],
                "unexpected ZIP file",
            ),
            (
                "missing",
                lambda entries: entries[1:],
                "incomplete ZIP inventory",
            ),
            (
                "duplicate",
                lambda entries: [entries[0], *entries],
                "duplicate ZIP file",
            ),
            (
                "symlink",
                lambda entries: [
                    (entries[0][0], b"candidate.json", "symlink"),
                    *entries[1:],
                ],
                "symlink ZIP entry",
            ),
        ]
        for label, mutate, pattern in cases:
            with self.subTest(case=label):
                self.assert_rejected(mutate, pattern)

    def test_rejects_noncanonical_and_nested_entries(self) -> None:
        cases = [
            (
                "dot prefix",
                lambda name: f"./{name}",
                "unsafe ZIP entry",
            ),
            (
                "repeated slash",
                lambda name: f"nested//{name}",
                "unsafe ZIP entry",
            ),
            (
                "nested",
                lambda name: f"nested/{name}",
                "unexpected ZIP file",
            ),
        ]
        for label, transform, pattern in cases:
            def mutate(entries, transform=transform):
                name, content, kind = entries[0]
                return [
                    (transform(name), content, kind),
                    *entries[1:],
                ]

            with self.subTest(case=label):
                self.assert_rejected(mutate, pattern)

    def test_rejects_existing_output_and_symlink_archive(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = make_updater_archive(root)
            output = root / "output"
            output.mkdir()
            with self.assertRaisesRegex(ValueError, "already exists"):
                RECOVERY.extract_updater_archive(
                    archive,
                    output,
                    VERSION,
                )

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = make_updater_archive(root)
            symlink = root / "updater-link.zip"
            try:
                os.symlink(archive.name, symlink)
            except OSError as error:
                self.skipTest(f"symlinks are unavailable: {error}")
            with self.assertRaisesRegex(
                ValueError,
                "regular non-symlink",
            ):
                RECOVERY.extract_updater_archive(
                    symlink,
                    root / "output",
                    VERSION,
                )


if __name__ == "__main__":
    unittest.main()
