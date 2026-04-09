#!/usr/bin/env bash
# deploy.sh — copy extensions from .pi/extensions/ to ~/.pi/agent/extensions/
# Run this when you're happy with an extension and want it available globally.

GLOBAL_DIR="$HOME/.pi/agent/extensions"
LOCAL_DIR="$(dirname "$0")/.pi/extensions"

for ext in "$LOCAL_DIR"/*/; do
  name=$(basename "$ext")
  echo "Deploying $name..."
  rm -rf "$GLOBAL_DIR/$name"
  cp -r "$ext" "$GLOBAL_DIR/$name"
done

echo "Done. Restart pi to pick up changes."
