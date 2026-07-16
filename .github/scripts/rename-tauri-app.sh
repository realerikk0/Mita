#!/bin/bash

# Check if the correct number of arguments is provided
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <path_to_json_input_file> <channel>"
    exit 1
fi

INPUT_JSON_FILE="$1"

CHANNEL="$2"

if [ "$CHANNEL" == "nightly" ]; then
    UPDATER="latest"
else
    UPDATER="beta"
fi

# Check if the input file exists
if [ ! -f "$INPUT_JSON_FILE" ]; then
    echo "Input file not found: $INPUT_JSON_FILE"
    exit 1
fi

# Use jq to transform the content
jq --arg channel "$CHANNEL" --arg updater "$UPDATER" '
    .productName = "Biyan-\($channel)" |
    .identifier = "biyan-\($channel).ai.app"
' "$INPUT_JSON_FILE" > ./tauri.conf.json.tmp

cat ./tauri.conf.json.tmp

rm $INPUT_JSON_FILE
mv ./tauri.conf.json.tmp $INPUT_JSON_FILE

# Update Info.plist if it exists
INFO_PLIST_PATH="./src-tauri/Info.plist"
if [ -f "$INFO_PLIST_PATH" ]; then
    echo "Updating Info.plist..."
    
    # Replace the stable compatibility bundle id with the channel-specific id.
    sed -i '' "s|uk\.jingxing\.mita|biyan-${CHANNEL}.ai.app|g" "$INFO_PLIST_PATH"
    
    # Replace only the canonical stable scheme; compatibility schemes remain.
    sed -i '' "s|<string>biyan</string>|<string>biyan-${CHANNEL}</string>|g" "$INFO_PLIST_PATH"

    echo "Info.plist updated"

    cat ./src-tauri/Info.plist
fi
