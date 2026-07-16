#!/usr/bin/env bash
set -euo pipefail

pkill -f Biyan || true
rm -rf ~/.config/Biyan ~/.config/Biyan-nightly
rm -rf ~/.local/share/Biyan ~/.local/share/Biyan-nightly
rm -rf ~/.cache/Biyan ~/.cache/Biyan-nightly
rm -f /tmp/biyan-installer.deb
