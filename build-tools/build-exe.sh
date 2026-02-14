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

# Step 3: Build Go executable
echo "Building executable..."
cd "$GO_DIR"
go build -ldflags="-s -w" -o "$SCRIPT_DIR/MBAM.exe" .

echo "Done! Built $SCRIPT_DIR/MBAM.exe ($(du -sh "$SCRIPT_DIR/MBAM.exe" | cut -f1))"
