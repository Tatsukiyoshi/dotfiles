---
name: review-pr
description: GitHub PRをレビューし、日本語でレビューコメントをPRに登録する。PR番号を引数に取る。
user-invocable: true
argument-hint: "[pr-number]"
---

# PRレビューワークフロー

GitHub PR **#$ARGUMENTS** をレビューする。全ての出力・コメントは**日本語**で行うこと。

## 1. PR情報の取得

以下のコマンドを並行して実行し、PRの全体像を把握する:

```bash
gh pr view $ARGUMENTS
gh pr diff $ARGUMENTS
```

PR本文に「〇〇のレビューを踏まえたPR」「Closes #XXX」など先行PRへの言及がある場合は、**先行PRのレビューコメントを必ず確認**してからコード分析に進む:

```bash
gh pr view <先行PR番号> --comments
```

## 2. Test Plan の確認

PR本文の Test Plan を確認し、**未チェック項目がある場合は PR コメントで補完されているかを検証する**。

```bash
gh pr view $ARGUMENTS --comments
```

### 判定ルール

| 状態 | 対応 |
|------|------|
| 全項目チェック済み | コード分析へ進む |
| 未チェック項目あり、かつ **PR コメントに当該項目の確認完了が明記されている** | コメントの内容を記録したうえでコード分析へ進む |
| 未チェック項目あり、かつ **PR コメントに確認の記述がない** | **レビューを打ち切る**（後述） |

> **Test Plan 自体が存在しない場合**はこのステップをスキップする。

### レビュー打ち切りの手順

未チェック項目に対応する PR コメントが確認できない場合は、コード分析に進まず、以下のコメントを投稿してレビューを終了する。

Write ツールで `.claude/tmp/gh-body.md` に書き出してから投稿すること:

```bash
gh pr comment $ARGUMENTS --body-file ".claude/tmp/gh-body.md"
rm .claude/tmp/gh-body.md
```

コメントのフォーマット:

```markdown
## レビュー保留: Test Plan の確認待ち

以下の Test Plan 項目が未チェックのまま、PR コメントでの確認も確認できませんでした。

- `[ ] <未チェック項目>`

動作確認が完了した場合は、チェックを `[x]` に更新するか、確認内容を PR コメントに記載してください。確認後、あらためてレビューします。
```

## 3. コード分析

差分を分析し、以下の観点でレビューする:

- **コードの正確性**: ロジックのバグ、エッジケースの見落とし
- **プロジェクト規約の遵守**: 既存のコードパターン・命名規則との一貫性
- **パフォーマンス**: 不要な再レンダリング、N+1クエリなどの問題
- **テストカバレッジ**: テストの充実度、重要なケースの網羅
- **セキュリティ**: XSS、インジェクション、認証・認可の問題
- **アクセシビリティ**: ARIA属性、キーボード操作対応
- **変更履歴の記述**: README.md の変更履歴がユーザー目線（「何ができるようになったか」）で書かれているか。技術的な実装詳細の羅列になっていないか

必要に応じて、差分に含まれるファイルの周辺コードも読み、変更のコンテキストを理解すること。

## 4. レビューコメントの登録

分析結果を以下のフォーマットで `gh pr review` を使ってPRに登録する。

> **注意**: `--body` に Markdown（バッククォート・コードブロック・特殊文字）を含む本文を直接渡すとシェルに解釈されてエラーになる。必ず Write ツールでプロジェクトの `.claude\tmp\gh-body.md` に書き出してから `--body-file` で渡すこと。PowerShell ツールで実行すること（Write ツールの出力パスと bash の `/tmp/` は別パスのため bash では読めない）。

```powershell
# Write ツールでプロジェクトの .claude\tmp\gh-body.md に本文を書き出してから実行する
gh pr review $ARGUMENTS --comment --body-file ".claude\tmp\gh-body.md"
Remove-Item ".claude\tmp\gh-body.md"
```

### レビューコメントのフォーマット

#### 見出し
1. ドキュメントの場合
  見出しをドキュメントレビューとする

1. コードの場合
  見出しをコードレビューとする

#### フォーマット例

```markdown
## <見出し>: <PRタイトル>

### 良い点

- 良い点を箇条書きで記載

### 指摘事項

#### 1. 指摘タイトル（重要度）

重要度は以下のいずれか:
- **必須**: マージ前に修正が必要
- **推奨**: 修正が望ましいがブロッキングではない
- **軽微**: 改善提案、好みの範囲

具体的な説明と、可能であれば改善案のコードを記載する。

### まとめ

全体的な評価と、マージ可否の判定を記載する。
```

## 5. 指摘事項の対応

指摘事項がある場合、内容に応じて以下のいずれかの方法で対応する。

### 対応方針の選択

| 指摘の種類 | 対応方法 |
|-----------|---------|
| **軽微**なスタイル・フォーマット修正（空行・インデント等） | PR のブランチに直接修正コミットを追加し、再テストする |
| **推奨** / **必須** の品質・動作・セキュリティに関わる指摘 | Issue化して課題一覧のSub-Issueとして登録する |
| 次の実装 Issue の着手前に直すべき小さな修正（その Issue 内で完結する） | 次の Issue にコメントで申し送りする |
| 将来の改善余地（確認事項） | 内容の重要度に応じてIssue化するか判断する |

> **注意**: 先行レビューで指摘していない内容をスコープ外でIssue化しないこと。

### 軽微な指摘を直接修正する場合

該当ブランチをチェックアウトして修正したあと、テストを実行する前に以下を必ず行う:

- 変更したファイルに対応するテストファイル（`*.test.ts` / `*.test.tsx`）を読み、修正によって壊れるアサーションがないかを確認する
- 壊れるアサーションは修正の意図に沿って更新してからテストを実行する
- **実行してエラーを見てから確認するのは誤り。実行前に完了させること**

その後、以下のコマンドで結果を記録しながらテストを実行する:

```bash
bun run lint 2>&1 | tee /tmp/lint-result.txt
bun run type-check 2>&1 | tee /tmp/typecheck-result.txt
bun run test 2>&1 | tee /tmp/test-result.txt
```

実行前に「何を確認するためにテストを実行するか」を明示してから実行すること。

その後、以下を必ず実施する:

1. **ブランチをリモートにプッシュする**:

```bash
git push origin <ブランチ名>
```

2. **PR に修正内容をコメントする**:

```powershell
# Write ツールで .claude\tmp\gh-body.md に本文を書き出してから実行する
gh pr comment $ARGUMENTS --body-file ".claude\tmp\gh-body.md"
Remove-Item ".claude\tmp\gh-body.md"
```

コメントには以下を含める:
- 対応したレビュー指摘の番号・タイトル
- 変更内容の概要（差分があれば before/after を記載）
- コミットハッシュ

### 申し送りとして残す場合

次の実装 Issue（例: 変換レイヤー実装 #XXX）の着手前に直すべき内容で、独立した Issue にするほどでもない小さな修正は、その Issue にコメントで申し送りする。

```powershell
# Write ツールで .claude\tmp\gh-body.md に本文を書き出してから実行する
gh issue comment <次のIssue番号> --body-file ".claude\tmp\gh-body.md"
Remove-Item ".claude\tmp\gh-body.md"
```

**申し送りコメントに含めるべき内容:**
- **見出し**: `## 着手前の確認事項（PR #XXX レビューより）`
- **内容**: 何をどう直すか（コードスニペットがあれば before/after を記載）

### Issue化して登録する場合

#### Issue作成手順

1. 指摘事項ごとに Issue 本文を **Write ツール** で `.claude\tmp\gh-body.md` に書き出し、`gh issue create --body-file` でIssueを作成して、発行されたIssue番号を取得する:

> **注意**: Issue 本文には Markdown（バッククォート・コードブロック等）が含まれるため、`--body` への直接渡しや `cat << EOF` ヒアドキュメントは使わず、必ず **Write ツールでファイルに書き出してから** `--body-file` で渡すこと。

Write ツールで `.claude\tmp\gh-body.md` を作成した後:

```powershell
$issueUrl = gh issue create `
  --title "<指摘の種別プレフィックス>: <指摘タイトル>" `
  --label "<ラベル>" `
  --body-file ".claude\tmp\gh-body.md"
$ISSUE_NUMBER = $issueUrl -split '/' | Select-Object -Last 1
Remove-Item ".claude\tmp\gh-body.md"
```

> **注意 (コマンド選択)**:
> - `awk -F'/' '{print $NF}'` は POSIX 準拠で macOS・Linux・Windows 全環境で動作する。
> - `grep -oP` は GNU grep 専用のため **macOS（BSD grep）および Windows では動作しない**。

> **タイトルの書き方**: コミットプレフィックス（`docs:` 等）をそのままタイトルに流用しない。課題の種類に応じて以下を使い分けること。
> - 機能追加・ドキュメント整備・運用手順など → **ユーザー目線**（何を達成・反映するか）
>   - NG: `docs: batch-design.md にスクリプト実行手順を追加する`
>   - OK: `曲対比インデックスの生成スクリプト実行手順をバッチ設計書に反映する`
> - リファクタ・テスト追加・内部改善など → **実装を明示**（何をどう変えるか）
>   - OK: `refactor: build-comparison-index.ts の型定義を types/comparison.ts と共有する`

**タイトルプレフィックスとラベルの対応:**

| プレフィックス | 用途 | `improvement` ラベル |
|--------------|------|-------------------|
| `fix:` | バグ・不正な動作 | 付与しない |
| `refactor:` | コード品質改善 | **付与する** |
| `test:` | テスト品質改善 | **付与する** |
| `perf:` | パフォーマンス | 軽微な最適化は**付与する**、重大な性能問題は付与しない |
| `docs:` | ドキュメント改善 | **付与する** |
| `feat:` | 新機能・機能追加 | 判断による（UX改善等は**付与する**） |

> **判断基準**: 「動作の正確性・信頼性・セキュリティに影響しない」改善であれば `improvement` を付与する。
> バグ修正・セキュリティ対策・入力検証の追加など、動作に直結するものは付与しない。

**本文に含めるべき内容:**
- **背景**: どのPRレビューで検出したか（例: `PR #200 のレビューで検出`）
- **現状**: 問題のあるコードスニペット
- **対応方針**: 修正の方向性
- **関連**: PR番号と課題管理Issue（課題を一覧として管理するIssue）

2. 作成したIssueを課題を一覧として管理するIssueのSub-Issueとして紐付ける:

Sub-Issueの登録には Issue の**データベースID**（大きな数値）が必要。

> **注意 (コマンド選択)**:
> - `gh api -F key=value` は値を文字列として送るため、整数型が要求されるフィールドに使うと 422 エラーになる（全プラットフォーム共通）。
> - `printf '{"key": %d}' VALUE | gh api --input -` で整数 JSON を送ること。

例）

```bash
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
ISSUE_DB_ID=$(gh api repos/$REPO/issues/$ISSUE_NUMBER --jq '.id')
printf '{"sub_issue_id": %d}' "$ISSUE_DB_ID" | gh api \
  --method POST \
  repos/$REPO/issues/80/sub_issues \
  --input -
```

3. 作成したIssueを課題管理Issueにコメントで追記する:

> **注意**: `--body` に Markdown を含む場合はシェルに解釈されエラーになる。必ず Write ツールでファイルに書き出してから `--body-file` で渡すこと。

例）

```powershell
# Write ツールで .claude\tmp\gh-body.md に本文を書き出してから実行する
gh issue comment 80 --body-file ".claude\tmp\gh-body.md"
Remove-Item ".claude\tmp\gh-body.md"
```

4. **課題一覧の「現在の注力領域」セクションへの追加（必須）**

   課題一覧（Issue #2）に「現在の注力領域」セクションが存在する場合、作成した Issue が注力領域の作業（例: Vercel Blob 移行）に関連するものであれば、必ずロードマップ表に行を追加すること。

   - ステータスは依存 Issue の状態に応じて `🔄 着手可能` または `⏳ 待機中` を設定する
   - 依存関係が明確でない場合は `⏳ 待機中` とし、依存欄に暫定的な情報を記載する
   - Write ツールで `/tmp/issue2-body.md` に本文を書き出し、`gh issue edit 2 --body-file /tmp/issue2-body.md && rm /tmp/issue2-body.md` で課題一覧を更新する

   > **注意**: 注力領域に追加せず「信頼性・正確性にかかわる項目」のみへの追加はしないこと。注力領域の作業に関連する Issue は両方のセクションに登録する。

## 6. 結果の表示

登録したレビュー内容のサマリーと、作成したIssue番号の一覧をユーザーに表示する。
