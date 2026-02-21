#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="${PREFIX:-/usr/local}/bin"
ln -sf "$SCRIPT_DIR/bin/ucm-dev.js" "$BIN_DIR/ucm-dev"
ln -sf "$SCRIPT_DIR/bin/ucmd-dev.js" "$BIN_DIR/ucmd-dev"
chmod +x "$SCRIPT_DIR/bin/ucm-dev.js" "$SCRIPT_DIR/bin/ucmd-dev.js"
echo "ucm-dev, ucmd-dev → $BIN_DIR"
