#!/bin/bash
# Claude Code グローバルスキルをインストールするセットアップスクリプト
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/.claude/skills"

mkdir -p "$TARGET_DIR"
cp -r "$SCRIPT_DIR/claude/skills/"* "$TARGET_DIR/"
echo "Claude skills installed to $TARGET_DIR"
