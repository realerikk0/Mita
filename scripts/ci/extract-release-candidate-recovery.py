#!/usr/bin/env python3

import argparse
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import sys
import zipfile


VERSION = re.compile(r"^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$")


def fail(message: str) -> None:
    raise ValueError(message)


def require_version(version: str) -> str:
    if not VERSION.fullmatch(version):
        fail("version must be a canonical stable semantic version")
    return version


def require_cli_path(value: str, label: str) -> Path:
    candidate = Path(value)
    if ".." in candidate.parts:
        fail(f"{label} must not contain parent traversal")
    if not candidate.is_absolute():
        candidate = Path.cwd() / candidate

    current = Path(candidate.anchor)
    remaining = candidate.parts[1:] if candidate.anchor else candidate.parts
    for part in remaining:
        current /= part
        try:
            mode = current.lstat().st_mode
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(mode):
            fail(f"{label} must not contain symlink path components: {current}")
    return candidate


def expected_archives(version: str) -> dict[str, tuple[str, set[str]]]:
    require_version(version)
    return {
        f"biyan-linux-x64-{version}": (
            "linux.zip",
            {
                f"appimage/Biyan_{version}_amd64.AppImage",
                f"appimage/Biyan_{version}_amd64.AppImage.sig",
                f"deb/Biyan_{version}_amd64.deb",
            },
        ),
        f"biyan-macos-universal-{version}": (
            "macos.zip",
            {
                f"dmg/Biyan_{version}_universal.dmg",
                "macos/Biyan.app.tar.gz",
                "macos/Biyan.app.tar.gz.sig",
            },
        ),
        f"biyan-windows-x64-{version}": (
            "windows.zip",
            {
                f"msi/Biyan_{version}_x64_en-US.msi",
                f"nsis/Biyan_{version}_x64-setup.exe",
                f"nsis/Biyan_{version}_x64-setup.exe.sig",
            },
        ),
    }


def expected_updater_files(version: str) -> set[str]:
    require_version(version)
    return {
        f"Biyan_{version}_universal.dmg",
        "Biyan.app.tar.gz",
        "Biyan.app.tar.gz.sig",
        f"Biyan_{version}_x64-setup.exe",
        f"Biyan_{version}_x64-setup.exe.sig",
        f"Biyan_{version}_x64_en-US.msi",
        f"Biyan_{version}_amd64.AppImage",
        f"Biyan_{version}_amd64.AppImage.sig",
        f"Biyan_{version}_amd64.deb",
        "candidate.json",
        "candidate.json.sig",
        "latest.json",
        "SHA256SUMS",
    }


def safe_member_name(
    name: str,
    artifact_name: str,
    *,
    is_directory: bool = False,
) -> PurePosixPath:
    if (
        not name
        or name.startswith("/")
        or "\\" in name
        or "\x00" in name
    ):
        fail(f"unsafe ZIP entry in {artifact_name}: {name!r}")

    canonical_name = name
    if is_directory:
        if not name.endswith("/") or name == "/":
            fail(f"unsafe ZIP entry in {artifact_name}: {name!r}")
        canonical_name = name[:-1]
    elif name.endswith("/"):
        fail(f"unsafe ZIP entry in {artifact_name}: {name!r}")

    raw_parts = canonical_name.split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        fail(f"unsafe ZIP entry in {artifact_name}: {name!r}")

    pure = PurePosixPath(canonical_name)
    if pure.as_posix() != canonical_name:
        fail(f"unsafe ZIP entry in {artifact_name}: {name!r}")
    return pure


def verify_inventory(
    archive: zipfile.ZipFile,
    artifact_name: str,
    expected_files: set[str],
) -> dict[str, zipfile.ZipInfo]:
    allowed_directories = {
        str(parent)
        for name in expected_files
        for parent in PurePosixPath(name).parents
        if str(parent) != "."
    }
    files: dict[str, zipfile.ZipInfo] = {}
    for item in archive.infolist():
        is_directory = item.is_dir()
        pure = safe_member_name(
            item.filename,
            artifact_name,
            is_directory=is_directory,
        )
        normalized = str(pure)
        mode = item.external_attr >> 16
        file_type = stat.S_IFMT(mode)
        if file_type == stat.S_IFLNK:
            fail(f"symlink ZIP entry in {artifact_name}: {item.filename!r}")
        if is_directory:
            if file_type not in {0, stat.S_IFDIR}:
                fail(
                    f"non-directory ZIP entry in {artifact_name}: "
                    f"{item.filename!r}"
                )
            if normalized not in allowed_directories:
                fail(
                    f"unexpected ZIP directory in {artifact_name}: "
                    f"{item.filename!r}"
                )
            continue
        if file_type not in {0, stat.S_IFREG}:
            fail(
                f"non-regular ZIP entry in {artifact_name}: "
                f"{item.filename!r}"
            )
        if normalized not in expected_files:
            fail(
                f"unexpected ZIP file in {artifact_name}: {item.filename!r}"
            )
        if item.file_size <= 0:
            fail(f"empty ZIP file in {artifact_name}: {item.filename!r}")
        if normalized in files:
            fail(f"duplicate ZIP file in {artifact_name}: {item.filename!r}")
        files[normalized] = item
    if set(files) != expected_files:
        fail(
            f"incomplete ZIP inventory in {artifact_name}: "
            f"{sorted(files)!r}"
        )
    return files


def extract_archive(
    archive_path: Path,
    destination: Path,
    artifact_name: str,
    expected_files: set[str],
) -> None:
    if archive_path.is_symlink() or not archive_path.is_file():
        fail(f"artifact archive must be a regular non-symlink file: {archive_path}")
    destination.mkdir(parents=True, mode=0o700, exist_ok=False)
    with zipfile.ZipFile(archive_path) as archive:
        files = verify_inventory(archive, artifact_name, expected_files)
        for name in sorted(files):
            target = destination.joinpath(*PurePosixPath(name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(files[name]) as source, target.open("xb") as sink:
                shutil.copyfileobj(source, sink)
            os.chmod(target, 0o600)


def extract_recovery_archives(
    archives_dir: Path,
    output_dir: Path,
    version: str,
) -> None:
    archives = expected_archives(version)
    if not archives_dir.is_dir():
        fail(f"archives directory does not exist: {archives_dir}")
    expected_archive_files = {filename for filename, _ in archives.values()}
    archive_entries = list(archives_dir.iterdir())
    actual_archive_files = {entry.name for entry in archive_entries}
    if (
        len(archive_entries) != len(expected_archive_files)
        or actual_archive_files != expected_archive_files
        or any(
            entry.is_symlink() or not entry.is_file()
            for entry in archive_entries
        )
    ):
        fail(
            "recovery archive directory must contain exactly three regular "
            "non-symlink ZIP files named "
            f"{sorted(expected_archive_files)!r}"
        )
    if output_dir.is_symlink() or output_dir.exists():
        fail(f"output directory already exists: {output_dir}")
    output_dir.mkdir(parents=True, mode=0o700)
    try:
        for artifact_name, (archive_file, expected_files) in archives.items():
            extract_archive(
                archives_dir / archive_file,
                output_dir / artifact_name,
                artifact_name,
                expected_files,
            )
    except BaseException:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise


def extract_updater_archive(
    updater_archive: Path,
    output_dir: Path,
    version: str,
) -> None:
    if output_dir.is_symlink() or output_dir.exists():
        fail(f"output directory already exists: {output_dir}")
    try:
        extract_archive(
            updater_archive,
            output_dir,
            f"biyan-updater-candidate-{version}",
            expected_updater_files(version),
        )
    except BaseException:
        shutil.rmtree(output_dir, ignore_errors=True)
        raise


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Safely extract exact authenticated release artifacts"
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--archives-dir")
    source.add_argument("--updater-archive")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--version", required=True)
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        if args.archives_dir is not None:
            extract_recovery_archives(
                require_cli_path(args.archives_dir, "archives directory"),
                require_cli_path(args.output_dir, "output directory"),
                args.version,
            )
        else:
            extract_updater_archive(
                require_cli_path(args.updater_archive, "updater archive"),
                require_cli_path(args.output_dir, "output directory"),
                args.version,
            )
    except (OSError, ValueError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
