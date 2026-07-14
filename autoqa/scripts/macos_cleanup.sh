#!/usr/bin/env bash
set -euo pipefail

pkill -f Biyan || true
rm -rf /Applications/Biyan.app /Applications/Biyan-nightly.app
rm -rf ~/Applications/Biyan.app ~/Applications/Biyan-nightly.app
rm -rf ~/Library/Application\ Support/Biyan ~/Library/Application\ Support/Biyan-nightly
rm -rf ~/Library/Caches/uk.jingxing.mita
rm -f /tmp/biyan-installer.dmg
rm -rf /tmp/biyan-mount
