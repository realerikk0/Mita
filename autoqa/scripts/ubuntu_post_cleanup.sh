#!/usr/bin/env bash
set -euo pipefail

is_nightly="${1:-false}"
pkill -f Biyan || true
package_name=biyan
if [ "$is_nightly" = "true" ]; then package_name=biyan-nightly; fi
sudo apt-get remove --purge -y "$package_name" 2>/dev/null || true
rm -rf ~/.config/Biyan ~/.config/Biyan-nightly
rm -rf ~/.local/share/Biyan ~/.local/share/Biyan-nightly
rm -rf ~/.cache/Biyan ~/.cache/Biyan-nightly
rm -f /tmp/biyan-installer.deb
