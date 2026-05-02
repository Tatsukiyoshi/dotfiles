---
name: think-issue
description: GitHub Issueの内容を検討し、要件の明確化・Issue分割の提案・不明点のユーザー確認を行う。Issue番号を引数に取る。
user-invocable: true
argument-hint: "[issue-number]"
---

# Issue 検討ワークフロー

GitHub Issue **#$ARGUMENTS** の内容を検討する。全ての出力は**日本語**で行うこと。

## 1. Issue 内容の取得

```bash
gh issue view $ARGUMENTS --json number,title,body,labels,milestone,assignees,comments
```

タイトル・本文・ラベル・マイルストーン・コメントを全て確認する。

## 2. 内容の分析

以下の観点でIssueを分析する。

### 2-1. 要件の明確性

- 「何を」「どのように」実装すべきかが明確か
- 受け入れ条件・完了基準が定義されているか
- 実装担当者が迷いなく着手できる状態か

### 2-2. スコープの適切さ

以下のいずれかに該当する場合、Issue分割を検討する:

- 複数の独立した機能・修正が1つのIssueに含まれている
- 「〇〇の実装」と「△△の対応」のように、並行して進められる作業が混在している
- 実装・レビューが1PRに収まらないほど大きい

### 2-3. 依存関係

- 他のIssueやPRへの依存があるか
- 依存がある場合、その依存先は本文に明記されているか

### 2-4. 技術的リスク・不明点

- 実装前に調査・検証が必要な技術的課題があるか
- 仕様として未決定の事項があるか

## 3. ユーザーへの質問

分析で不明点・確認事項が見つかった場合は、ユーザーに質問する。

- 質問は番号付きリストで列挙する
- 各質問に「なぜ確認が必要か」を1行で添える
- ユーザーの回答を待ってから次のステップに進む

確認事項が何もない場合は「確認事項なし」と明記してステップ4に進む。

## 4. Issue分割の提案

ステップ2-2でIssue分割が必要と判断した場合、以下の形式で分割案を提示し、ユーザーの承認を得る。

```
【Issue分割の提案】

現在のIssue: #$ARGUMENTS {タイトル}

分割案:
1. {分割後Issue1のタイトル}
   - 内容: {実装する内容の概要}
   - ラベル: {ラベル}

2. {分割後Issue2のタイトル}
   - 内容: {実装する内容の概要}
   - ラベル: {ラベル}

元Issue #$ARGUMENTS は分割後も親Issueとして残します。
承認する場合は「OK」、修正が必要な場合は変更内容をお伝えください。
```

ユーザーが承認した場合のみ、ステップ5に進む。

**分割が不要な場合はこのステップをスキップする。**

## 5. Sub-Issue の作成（承認済みの場合のみ）

### 5-1. 親IssueのノードIDを取得

```bash
gh issue view $ARGUMENTS --json id --jq '.id'
```

### 5-2. Sub-Issue を作成

ラベル・マイルストーンは元Issueから引き継ぐ。

```bash
gh issue create \
  --title "{タイトル}" \
  --body "{本文}" \
  --label "{ラベル}" \
  --milestone "{マイルストーン番号}"
```

### 5-3. 親Issueに紐付ける

```bash
# 作成したIssueのノードIDを取得
gh issue view {新Issue番号} --json id --jq '.id'

# Sub-Issueとして登録
gh api graphql -f query='mutation {
  addSubIssue(input: {issueId: "{PARENT_NODE_ID}", subIssueId: "{CHILD_NODE_ID}"}) {
    issue { number }
  }
}'
```

### 5-4. 元Issueにコメントを追記

分割の経緯と作成したSub-Issue番号を元Issueにコメントとして記録する。

> **注意**: `--body` にMarkdownを含む場合はWriteツールでファイルに書き出し `--body-file` で渡すこと。

```bash
gh issue comment $ARGUMENTS --body-file /tmp/think-issue-comment.md
rm /tmp/think-issue-comment.md
```

## 6. 検討結果の報告

ユーザーに検討結果をまとめて報告する:

- 分析で気づいた点（要件の明確性・依存関係・リスク）
- 確認事項とその結果
- Issue分割を行った場合: 作成したSub-Issue番号と各タイトルの一覧
- **推奨アクション**: 次に何をすべきか（例: `/implement-issue $ARGUMENTS` で実装着手、先行Issueの完了待ち、など）
