#!/bin/bash

# ChatGPT UX Suite - Extension Zip Script
# Zips the extension and copies it to treats.sh products folder

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXTENSION_DIR="chatgpt_ux_suite_extension"
ZIP_NAME="chatgpt_ux_suite_extension.zip"
DEST_DIR="$HOME/Documents/treats.sh/products"

cd "$SCRIPT_DIR"

# Remove existing zip
if [ -f "$ZIP_NAME" ]; then
    echo "Removing existing $ZIP_NAME..."
    rm "$ZIP_NAME"
fi

# Create new zip
echo "Creating $ZIP_NAME..."
zip -r "$ZIP_NAME" "$EXTENSION_DIR" -x "*.DS_Store"

# Copy to destination
if [ -d "$DEST_DIR" ]; then
    echo "Copying to $DEST_DIR..."
    cp "$ZIP_NAME" "$DEST_DIR/"
    echo "Done! Zip copied to $DEST_DIR/$ZIP_NAME"
else
    echo "Warning: Destination directory $DEST_DIR does not exist"
    echo "Zip file created locally at $SCRIPT_DIR/$ZIP_NAME"
fi
