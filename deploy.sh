#!/usr/bin/env bash
# deploy.sh — copy extensions from .pi/extensions/ to ~/.pi/agent/extensions/
# Run this when you're happy with an extension and want it available globally.

GLOBAL_DIR="$HOME/.pi/agent/extensions"
LOCAL_DIR="$(dirname "$0")/extensions"

for ext in "$LOCAL_DIR"/*/; do
  name=$(basename "$ext")
  pkg="$ext/package.json"

  # Only deploy extensions with "deploy": true in their pi config block
  if [ ! -f "$pkg" ]; then
    echo "Skipping $name (no package.json)"
    continue
  fi

  deploy=$(node -e "try{const p=require('$pkg');process.stdout.write(String(p?.pi?.deploy===true))}catch{process.stdout.write('false')}")
  if [ "$deploy" != "true" ]; then
    echo "Skipping $name (pi.deploy not set to true)"
    continue
  fi

  echo "Deploying $name..."
  rm -rf "$GLOBAL_DIR/$name"
  cp -r "$ext" "$GLOBAL_DIR/$name"
done

echo "Done. Restart pi to pick up changes."
