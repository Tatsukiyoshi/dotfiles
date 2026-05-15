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

```powershell
# Write ツールでプロジェクトの .claude\tmp\gh-body.md にコメント本文を書き出してから実行する
gh issue comment $ARGUMENTS --body-file ".claude\tmp\gh-body.md"
gh issue close $ARGUMENTS --reason <completed|not planned>
Remove-Item ".claude\tmp\gh-body.md"
```

## 4. マイルストーンの確認・クローズ

Issue がマイルストーンに属している場合、そのマイルストーンの全 Issue がクローズ済みかを確認する。

```bash
# Issue のマイルストーン番号を取得
gh issue view $ARGUMENTS --json milestone --jq '.milestone.number // empty'
```

マイルストーン番号が取得できた場合:

```bash
# マイルストーン内の Open Issue 数を確認
gh api repos/:owner/:repo/milestones/<milestone_number> --jq '.open_issues'
```

`open_issues` が **0** であれば、マイルストーンをクローズする:

```bash
gh api --method PATCH repos/:owner/:repo/milestones/<milestone_number> -f state=closed --jq '.title, .state'
```

クローズした場合はユーザーに報告する（例: "マイルストーン『v3.6.0』をクローズしました"）。

## 5. 課題一覧の更新

課題一覧（Issue #2）の該当行の状態を `OPEN` → `CLOSED` に更新する。

推奨手順:
1. `gh issue view 2 --json body --jq '.body'` で現在の本文を取得・確認する
2. 対象行を特定し、Write ツールでプロジェクトの `.claude\tmp\gh-body.md` に更新後の本文を書き出す
3. PowerShell ツールで反映・削除する:

```powershell
# Write ツールで .claude\tmp\gh-body.md に本文を書き出してから実行する
gh issue edit 2 --body-file ".claude\tmp\gh-body.md"
Remove-Item ".claude\tmp\gh-body.md"
```

> **注意**: `gh issue edit` に `--body-file` を渡すファイルは必ず Write ツールでプロジェクト配下の `.claude\tmp\gh-body.md` に書き出してから PowerShell ツールで実行すること。bash の `/tmp/` は Write ツールのパスと異なるため読めない。

## 6. 結果の表示

クローズしたIssue番号・タイトル・理由を簡潔にユーザーに報告する。
