#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 1 ]]; then
  echo "usage: run-untrusted-qualification-verifier.sh [--read-root DIR] <verifier.mjs> [args...]" >&2
  exit 64
fi

: "${PATH:?PATH must be set}"

read_root=""
if [[ "${1:-}" == "--read-root" ]]; then
  if [[ "$#" -lt 3 ]]; then
    echo "--read-root requires a directory and verifier" >&2
    exit 64
  fi
  read_root_input="$2"
  shift 2
  if [[ -L "$read_root_input" || ! -d "$read_root_input" ]]; then
    echo "Qualification read root must be a non-symlink directory: $read_root_input" >&2
    exit 1
  fi
  read_root="$(cd "$read_root_input" && pwd -P)"
  if [[ "$read_root" == "/" ]]; then
    echo "Qualification read root must not be the filesystem root" >&2
    exit 1
  fi
fi

source_input="$1"
shift

if [[ -L "$source_input" ]]; then
  echo "Qualification verifier must not be a symbolic link: $source_input" >&2
  exit 1
fi
if [[ ! -f "$source_input" ]]; then
  echo "Qualification verifier must be a regular file: $source_input" >&2
  exit 1
fi

source_directory="$(cd "$(dirname "$source_input")" && pwd -P)"
source_verifier="$source_directory/$(basename "$source_input")"
if [[ -L "$source_verifier" || ! -f "$source_verifier" ]]; then
  echo "Qualification verifier changed before it could be copied: $source_input" >&2
  exit 1
fi

sha256_file() {
  node -e '
    const crypto = require("node:crypto")
    const fs = require("node:fs")
    const hash = crypto.createHash("sha256")
    const descriptor = fs.openSync(process.argv[1], "r")
    const buffer = Buffer.allocUnsafe(1024 * 1024)
    try {
      for (;;) {
        const bytesRead = fs.readSync(
          descriptor,
          buffer,
          0,
          buffer.length,
          null
        )
        if (bytesRead === 0) break
        hash.update(buffer.subarray(0, bytesRead))
      }
    } finally {
      fs.closeSync(descriptor)
    }
    process.stdout.write(hash.digest("hex"))
  ' "$1"
}

sandbox_root=""
acl_backup=""
acl_restore_needed=false
cleanup() {
  local status=$?
  local cleanup_failed=false
  trap - EXIT HUP INT TERM
  if [[ "$acl_restore_needed" == true ]]; then
    if ! sudo setfacl --restore="$acl_backup"; then
      echo "Failed to restore qualification read-root ancestor ACLs" >&2
      cleanup_failed=true
    fi
  fi
  if [[ -n "$sandbox_root" && -e "$sandbox_root" ]]; then
    if ! sudo chmod -R u+rwx "$sandbox_root"; then
      echo "Failed to unlock qualification verifier sandbox: $sandbox_root" >&2
      cleanup_failed=true
    fi
    if ! sudo rm -rf "$sandbox_root"; then
      echo "Failed to remove qualification verifier sandbox: $sandbox_root" >&2
      cleanup_failed=true
    fi
  fi
  if [[ "$cleanup_failed" == true && "$status" -eq 0 ]]; then status=1; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

umask 077
sandbox_root="$(mktemp -d /tmp/biyan-untrusted-verifier.XXXXXX)"
if [[ ! -O "$sandbox_root" ]]; then
  echo "Qualification verifier sandbox is not runner-owned: $sandbox_root" >&2
  exit 1
fi
sandbox_exec="$sandbox_root/exec"
sandbox_control="$sandbox_root/control"
sandbox_home="$sandbox_root/home"
sandbox_verifier="$sandbox_exec/verify-qualification-artifacts.mjs"
mkdir "$sandbox_exec" "$sandbox_control" "$sandbox_home"
acl_backup="$sandbox_control/ancestor-acls.txt"

source_sha256="$(sha256_file "$source_verifier")"
cp "$source_verifier" "$sandbox_verifier"

if [[ -L "$source_verifier" || ! -f "$source_verifier" ]]; then
  echo "Qualification verifier changed while it was being copied" >&2
  exit 1
fi
current_source_sha256="$(sha256_file "$source_verifier")"
copied_sha256="$(sha256_file "$sandbox_verifier")"
if [[ "$current_source_sha256" != "$source_sha256" ]]; then
  echo "Qualification verifier changed while it was being copied" >&2
  exit 1
fi
if [[ "$copied_sha256" != "$source_sha256" ]]; then
  echo "Copied qualification verifier SHA-256 mismatch" >&2
  exit 1
fi

chmod 0444 "$sandbox_verifier"
chmod 0700 "$sandbox_home"
sudo chown nobody "$sandbox_home"
chmod 0555 "$sandbox_exec" "$sandbox_root"

sudo -u nobody test -r "$sandbox_verifier"

if [[ -n "$read_root" ]]; then
  if ! command -v getfacl >/dev/null || ! command -v setfacl >/dev/null; then
    echo "getfacl and setfacl are required with --read-root" >&2
    exit 1
  fi

  ancestor="$(cd "$(dirname "$read_root")" && pwd -P)"
  ancestor_paths=()
  while [[ "$ancestor" != "/" ]]; do
    ancestor_paths+=("$ancestor")
    ancestor="$(dirname "$ancestor")"
  done
  if [[ "${#ancestor_paths[@]}" -eq 0 ]]; then
    echo "Qualification read root has no safe ancestor ACL scope" >&2
    exit 1
  fi

  if [[ -n "$(find "$read_root" -user nobody -print -quit)" ]]; then
    echo "Qualification read root must not contain nobody-owned paths" >&2
    exit 1
  fi

  getfacl --absolute-names --recursive "$read_root" >"$acl_backup"
  getfacl --absolute-names "${ancestor_paths[@]}" >>"$acl_backup"
  chmod 0400 "$acl_backup"
  acl_restore_needed=true
  for ancestor in "${ancestor_paths[@]}"; do
    sudo setfacl -m u:nobody:--x "$ancestor"
  done
  sudo setfacl --recursive -m u:nobody:rX "$read_root"
  sudo -u nobody test -r "$read_root"
  sudo -u nobody test -x "$read_root"
fi

sudo -u nobody env -i PATH="$PATH" HOME="$sandbox_home" \
  node "$sandbox_verifier" "$@"
