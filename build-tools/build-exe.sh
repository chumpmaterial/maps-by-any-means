#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REACT_DIR="$SCRIPT_DIR/../react"
GO_DIR="$SCRIPT_DIR/go"

# Step 1: Build React app
echo "Building React app..."
cd "$REACT_DIR"
npm run build

# Step 2: Copy dist to Go embed directory
echo "Copying dist files..."
rm -rf "$GO_DIR/dist"
cp -r "$REACT_DIR/dist" "$GO_DIR/dist"

# Step 3: Embed icon into .syso resource file
echo "Embedding icon..."
cp "$REACT_DIR/public/favicon.ico" "$GO_DIR/favicon.ico"
go install github.com/akavel/rsrc@latest
cd "$GO_DIR"
rsrc -ico favicon.ico -o rsrc.syso
rm favicon.ico

# Step 4: Build Go executable
echo "Building executable..."
go build -ldflags="-s -w" -o "$SCRIPT_DIR/MBAM.exe" .
rm -f rsrc.syso

echo "Done! Built $SCRIPT_DIR/MBAM.exe ($(du -sh "$SCRIPT_DIR/MBAM.exe" | cut -f1))"
