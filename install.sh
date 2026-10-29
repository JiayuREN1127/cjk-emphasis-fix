#!/usr/bin/env bash
# Install CJK Emphasis Fix into an Obsidian vault and enable it.
# Usage: ./install.sh "/path/to/vault"
set -euo pipefail

VAULT="${1:?usage: ./install.sh \"/path/to/vault\"}"
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_ID="cjk-emphasis-fix"
DEST="$VAULT/.obsidian/plugins/$PLUGIN_ID"

if [ ! -d "$VAULT/.obsidian" ]; then
  echo "error: $VAULT is not an Obsidian vault (no .obsidian directory)" >&2
  exit 1
fi

mkdir -p "$DEST"
cp "$SRC_DIR/main.js" "$SRC_DIR/manifest.json" "$SRC_DIR/versions.json" "$DEST/"
echo "installed -> $DEST"

# Enable the plugin in community-plugins.json (idempotent).
CONFIG="$VAULT/.obsidian/community-plugins.json"
if [ -f "$CONFIG" ]; then
  if grep -q "\"$PLUGIN_ID\"" "$CONFIG"; then
    echo "already enabled"
  else
    python3 - "$CONFIG" "$PLUGIN_ID" <<'PY'
import json, sys
path, plugin_id = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as fh:
    plugins = json.load(fh)
if plugin_id not in plugins:
    plugins.append(plugin_id)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(plugins, fh, ensure_ascii=False, indent=2)
    print("enabled:", plugin_id)
PY
  fi
else
  printf '[\n  "%s"\n]\n' "$PLUGIN_ID" > "$CONFIG"
  echo "created community-plugins.json with plugin enabled"
fi

echo "done. Reload Obsidian (or reopen the vault) to activate."
