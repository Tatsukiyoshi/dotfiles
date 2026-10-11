# 開発ノート

dotfiles で管理する Claude Code のスキル・プラグイン（Mod）の開発で得た知見を記録する。実装前に関連するカテゴリを確認すること。

## 実装

### 1. Mod API は Claude Code の版で大きく変わる。検証・読み込みは PATH 上の CLI の版で動く（dotfiles#8）

Mod（関数フックのプラグイン）の API は早期アクセスで、版ごとにイベントや API が増減する。`claude plugin validate`・`claude plugin test`・実際の読み込みは、どれも PATH 上の `claude` の版で動く。

- 例: 2.1.247 には `tool.check` イベントがなく、validate が「"tool.check" is not an event」で失敗した。2.1.296 に更新すると通った
- plugin-authoring スキルが出力する型定義（`claude-code.d.ts`）は、スキルを読み込んだセッション本体の版のもの。PATH 上の CLI と版が違うことがある
- 「イベントがない」系のエラーが出たら、まず `claude --version` とセッション本体の版を見比べる。古ければ `claude update` で更新する
- Zed の Claude（`claude-agent-acp`）は同梱の SDK の版で動く（`%LOCALAPPDATA%\Zed\external_agents\registry\npx\claude-acp\node_modules\@anthropic-ai\claude-agent-sdk\package.json` で確認できる）

### 2. `$.state` の atom は plugin・key を文字列リテラルで書く（dotfiles#8）

`atom({ plugin: PLUGIN, key: 'calls' })` のように定数で書くと、`claude plugin validate` が「the state library's atom takes a source the scan can read」で失敗する。validate はソースを静的に読むため、`plugin` と `key` は文字列リテラルで直接書く。

```ts
// NG
const calls = atom({ plugin: PLUGIN, key: 'calls' } as const, [])

// OK
const calls = atom({ plugin: 'hold-permission-prompt', key: 'calls' } as const, [])
```

### 3. 入力欄の上の帯（`AbovePrompt`）はターミナルとデスクトップアプリでしか描画されない（dotfiles#8）

`ui.render` の `AbovePrompt` は terminal・desktop の surface でしか描画されず、Zed 等の SDK ホストでは表示されない。どのクライアントでも操作させたい機能は、帯のボタンだけに頼らず、入力欄のテキスト（`prompt.submit` で横取りする合言葉等）でも操作できるようにする。

- ターミナルでも、帯のボタンは入力欄にフォーカスがあるとキーが届かない。`ctrl+x` → `tab` で帯にフォーカスを移す必要がある
- `prompt.submit` で `{ drop }` を返すと、Zed では「Warning: Prompt dropped by a hook: …」として表示される
- プロンプトの出どころ（`e.origin.kind`）は、ターミナルが `composer`、Zed 等の SDK ホストが `sdk`

### 4. Mod から送るプロンプトより、ユーザーのプロンプトを書き換える方が確実に届く（dotfiles#8）

`$.prompt.submit` はセッションが空いたときに新しいターンとして送られるが、SDK ホストで確実に届くかは型定義からは判断できない。ユーザーの入力に応じてモデルに連絡したいときは、`prompt.submit` フックでそのプロンプト自体を `next({ ...e, text })` で書き換える方が確実。

### 5. 自前の Mod は `~/.claude/plugins/` に置かない（dotfiles#8）

`~/.claude/plugins/` は Claude Code がマーケットプレイスのプラグイン管理に使うフォルダ（`cache`・`marketplaces`・`installed_plugins.json` 等があり、未使用分の掃除 `.last_inuse_sweep` も走る）。自前の Mod は `~/.claude/mods/` 等の別フォルダに置き、`CLAUDE_CODE_PLUGIN_DIRS` で読み込む。

- SDK ホスト（Zed 等）のセッションは、`CLAUDE_CODE_PLUGIN_DIR_WATCH=1` を設定しない限りプラグインのフォルダを監視しない。Mod を配置し直したら新しいスレッドを開く

### 6. tool.check で保留した操作の承認後は、エンジンが整えた入力で一致を判定する（dotfiles#8）

`tool.check` の `e.input` は、モデルが出した引数そのものではなく、エンジンが整えた入力になる。

- キーの並びはエンジン側で決まる（Bash では `command`・`timeout`・`description` の順になった）
- 省略した既定値が入ることがある（Edit では `replace_all: false` が入った）
- 作業ディレクトリへの `cd` が外されることがある（Bash の `cd /d/Repository/dotfiles && ...` が `...` だけになった）

入力の一致で承認済みかを判定する場合、再実行時はエンジンが記録した入力（承認の連絡に載せたもの）に合わせる。

## テスト手法

### 1. `claude plugin test` では、Mod が `next(e)` で任せる先の受け手をテスト側で用意する（dotfiles#8）

テストキットでは、Mod の下にエンジンがいない。Mod が `next(e)` を呼ぶイベントは、テストの `on` で受け手を用意しないと「no implementation for ui.render」等で失敗する。

```ts
on('tool.check', () => ({ decision: 'ask' }))
on('prompt.submit', ($, e) => ({ text: e.text }))
on('turn.start', ($, e) => ({ turnId: e.turnId }))
on('turn.complete', () => ({ text: '' }))
on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
```

- `$.turn.complete` の入力には `answer`・`durationMs`・`isAborted`・`reason` が必要
- 型チェックは、Mod が読み込まれる前は `.claude-plugin/types/` がないため、スキルの型定義（`claude-code.d.ts`）を `include` に入れた tsconfig を Mod フォルダの外（`.claude/tmp/` 等）に置いて `tsc -p` する
