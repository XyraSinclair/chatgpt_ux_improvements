#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST="$ROOT_DIR/manifest.json"

if [[ ! -f "$MANIFEST" ]]; then
  echo "manifest.json not found in $ROOT_DIR" >&2
  exit 1
fi

VERSION=$(python3 - "$MANIFEST" <<'PY'
import json, sys
from pathlib import Path
manifest_path = Path(sys.argv[1])
with manifest_path.open() as fh:
    data = json.load(fh)
print(data.get('version', '0.0.0'))
PY
)

if [[ -z "$VERSION" ]]; then
  echo "Unable to determine version from manifest.json" >&2
  exit 1
fi

DIST_DIR="$ROOT_DIR/dist"
ZIP_NAME="chatgpt-context-counter-extension-v$VERSION.zip"

mkdir -p "$DIST_DIR"

TMP_DIR=$(mktemp -d)
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

rsync -a \
  --exclude '.git' \
  --exclude '.gitignore' \
  --exclude 'dist' \
  --exclude 'scripts' \
  --exclude 'docs' \
  --exclude '*.zip' \
  --exclude '*.md' \
  --exclude '.DS_Store' \
  "$ROOT_DIR/" "$TMP_DIR/"

(
  cd "$TMP_DIR"
  zip -qr "$DIST_DIR/$ZIP_NAME" .
)

echo "Created $DIST_DIR/$ZIP_NAME"
