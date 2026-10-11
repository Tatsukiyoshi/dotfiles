#!/bin/bash
# Claude Code グローバルスキル・プラグイン（Mod）をインストールするセットアップスクリプト
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR="$HOME/.claude/skills"
# ~/.claude/plugins は Claude Code がマーケットプレイスのプラグイン管理に使うため、自前の Mod は別の場所に置く
PLUGIN_TARGET_DIR="$HOME/.claude/mods"

mkdir -p "$TARGET_DIR"
cp -r "$SCRIPT_DIR/claude/skills/"* "$TARGET_DIR/"
echo "Claude skills installed to $TARGET_DIR"

# プラグインは CLAUDE_CODE_PLUGIN_DIRS で読み込む（各プラグインの README.md 参照）
# テストはエンジンが読み込まないため、配置先には含めない
# README は設定方法（settings.json への追記）を配置先からたどれるようにコピーする
for plugin in "$SCRIPT_DIR/claude/plugins/"*/; do
  name="$(basename "$plugin")"
  rm -rf "${PLUGIN_TARGET_DIR:?}/$name"
  mkdir -p "$PLUGIN_TARGET_DIR/$name"
  # Mod ごとに構成が違っても止まらないよう、tests 以外をすべてコピーする（* はドットで始まる .claude-plugin を含まないため別に指定する）
  for entry in "${plugin}.claude-plugin" "${plugin}"*; do
    [ "$(basename "$entry")" = "tests" ] && continue
    cp -r "$entry" "$PLUGIN_TARGET_DIR/$name/"
  done
  echo "Claude plugin $name installed to $PLUGIN_TARGET_DIR/$name"
done
