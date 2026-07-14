#!/usr/bin/env bash
set -euo pipefail

is_nightly="${1:-false}"
sudo dpkg -i /tmp/biyan-installer.deb || sudo apt-get install -f -y
if [ "$is_nightly" = "true" ]; then
  app_path=/usr/bin/Biyan-nightly
  process_name=Biyan-nightly
else
  app_path=/usr/bin/Biyan
  process_name=Biyan
fi
test -x "$app_path"
echo "BIYAN_APP_PATH=$app_path" >> "$GITHUB_ENV"
echo "BIYAN_PROCESS_NAME=$process_name" >> "$GITHUB_ENV"
