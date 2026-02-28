---
name: close-issue
description: GitHub Issueを適切なコメント付きでクローズし、課題一覧の状態を更新する。Issue番号を引数に取る。
user-invokable: true
argument-hint: "[issue-number]"
---

# Issue クローズワークフロー

GitHub Issue **#$ARGUMENTS** をクローズする。

## 1. Issue 情報の取得

```bash
gh issue view $ARGUMENTS
```

Issue のタイトル・本文・現在状態を確認し、クローズ理由を把握する。

## 2. クローズ理由の確認

ユーザーからクローズ理由が伝えられていない場合は、Issue の内容から判断する:

- **completed**: 実装・修正・対応が完了した
- **not planned**: 前提が消滅した、方針変更、対応しないと判断した

## 3. クローズコメントの作成と登録

> **注意**: `--body` に Markdown（バッククォート・コードブロック・特殊文字）を含む本文を直接渡すとシェルに解釈されてエラーになる。必ず Write ツールでファイルに書き出してから `--body-file` で渡すこと。
> また、`gh issue close` は `--comment-file` を**サポートしない**。コメント追加とクローズは別々のコマンドで実行すること。

コメントには以下を含める:
- クローズする理由（背景の変化、対応完了の根拠など）
- 関連PR・Issue番号（あれば）

```bash
# Write ツールで /tmp/close-comment.md にコメント本文を書き出してから実行する
gh issue comment $ARGUMENTS --body-file /tmp/close-comment.md
gh issue close $ARGUMENTS --reason <completed|not planned>
rm /tmp/close-comment.md
```

## 4. 課題一覧の更新

課題一覧（Issue #2）の該当行の状態を `OPEN` → `CLOSED` に更新する。

```bash
# 現在の本文を取得してファイルに保存
gh issue view 2 --json body | jq -r '.body' > /tmp/issue2-current.md

# sed で状態を更新（macOS の sed は -i '' が必要）
sed 's/| #$ARGUMENTS | .* | OPEN |/... | CLOSED |/' /tmp/issue2-current.md > /tmp/issue2-updated.md
```

> **注意**: sed による置換は誤マッチのリスクがある。対象行を確認してから Write ツールで直接編集する方が安全。

推奨手順:
1. `/tmp/issue2-current.md` の内容を Read ツールで確認する
2. 対象行を特定して Write ツールで `/tmp/issue2-updated.md` に正確な本文を書き出す
3. `gh issue edit 2 --body-file /tmp/issue2-updated.md && rm /tmp/issue2-current.md /tmp/issue2-updated.md` で反映する

## 5. 結果の表示

クローズしたIssue番号・タイトル・理由を簡潔にユーザーに報告する。
