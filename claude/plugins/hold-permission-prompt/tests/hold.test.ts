import { describe, expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On, PromptOrigin, ToolCheckDecision } from 'claude-code'

import {
  RESOLVE_TOOL,
  holdReason,
  inputKeyOf,
  isAnswered,
  parseCommand,
  questionHoldReason,
  reRunInstruction,
  summarize,
  toggleSelection,
} from '../hooks/register'

const PLUGIN = 'hold-permission-prompt'

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const TURN_END = { answer: '', durationMs: 0, isAborted: false, reason: 'answer' } as const

const BASH_INPUT = { command: 'git push origin main', description: 'Push to main' }

// エンジン側の判定・プロンプト送信を test の on で受ける（プラグインの下に置かれる）
function setUp(on: On, decision: ToolCheckDecision = 'ask') {
  const submitted: string[] = []
  on('tool.check', () => ({ decision }))
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  // 保留がないとき Mod は next(e) でエンジンの描画に任せるので、その受け手として空の Box を返す
  on('ui.render', ($, e) => $.ui.resolve(e).Box({}))
  return submitted
}

function checkBash($: Engine, id: string) {
  return $.tool.check({ tool: 'Bash', input: BASH_INPUT, tool_use_id: id })
}

function checkWrite($: Engine, id: string) {
  return $.tool.check({ tool: 'Write', input: { file_path: 'a.txt', content: 'x' }, tool_use_id: id })
}

function askQuestions($: Engine, id: string) {
  return $.tool.call({ tool: 'AskUserQuestion', tool_use_id: id, questions: QUESTIONS })
}

function mountBand($: Engine) {
  return $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
}

function type($: Engine, text: string, origin: PromptOrigin = { kind: 'sdk' }) {
  return $.prompt.submit({ text, origin, wait: false })
}

const QUESTIONS = [
  {
    question: 'どの方式にする？',
    header: '方式',
    options: [
      { label: 'A案', description: 'A' },
      { label: 'B案', description: 'B' },
    ],
    multiSelect: false,
  },
  {
    question: 'どれを有効にする？',
    header: '機能',
    options: [
      { label: 'X', description: 'X' },
      { label: 'Y', description: 'Y' },
      { label: 'Z', description: 'Z' },
    ],
    multiSelect: true,
  },
]

describe('確認待ちの操作', () => {
  test('ask の操作を通し番号付きで保留にし、帯に表示する', async ($, on) => {
    setUp(on)

    expect(await checkBash($, 'call-1')).toEqual({ decision: 'deny', reason: holdReason(1) })

    const band = await mountBand($)
    expect((await band.find({ key: 'approve:1' }))?.text).toBe('承認')
    expect(await band.find({ text: BASH_INPUT.command })).toBeDefined()
  })

  test('承認すると同じ入力の1回分だけ allow し、2回目はまた保留にする', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await (await mountBand($)).press({ key: 'approve:1' })

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain(`承認（#1）: ${summarize('Bash', BASH_INPUT)}`)
    expect(submitted[0]).toContain(JSON.stringify(BASH_INPUT))

    expect((await checkBash($, 'call-2')).decision).toBe('allow')
    expect(await checkBash($, 'call-3')).toEqual({ decision: 'deny', reason: holdReason(2) })
  })

  test('入力が1文字でも違う呼び出しは承認済みとして扱わない', async ($, on) => {
    setUp(on)

    await checkBash($, 'call-1')
    await (await mountBand($)).press({ key: 'approve:1' })

    const changed = { ...BASH_INPUT, command: `${BASH_INPUT.command} ` }
    const verdict = await $.tool.check({ tool: 'Bash', input: changed, tool_use_id: 'call-2' })
    expect(verdict.decision).toBe('deny')
  })

  test('却下すると却下の連絡を送り、帯から消える', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    const band = await mountBand($)
    await band.press({ key: 'reject:1' })

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain(`却下（#1）: ${summarize('Bash', BASH_INPUT)}`)
    expect(await band.find({ key: 'approve:1' })).toBeUndefined()
    expect((await checkBash($, 'call-2')).decision).toBe('deny')
  })

  test('同じ入力の操作が続けて保留になっても同じ番号のまま1件だけ表示する', async ($, on) => {
    setUp(on)

    await checkBash($, 'call-1')
    expect(await checkBash($, 'call-2')).toEqual({ decision: 'deny', reason: holdReason(1) })

    const band = await mountBand($)
    expect(await band.findAll({ type: 'Button', text: '承認' })).toHaveLength(1)
  })

  test('ask 以外の判定はそのまま返す', async ($, on) => {
    setUp(on, 'allow')

    expect(await checkBash($, 'call-1')).toEqual({ decision: 'allow' })
  })

  test('tool_use_id のない問い合わせは保留にしない', async ($, on) => {
    setUp(on)

    expect(await $.tool.check({ tool: 'Bash', input: BASH_INPUT })).toEqual({ decision: 'ask' })
  })

  test('ExitPlanMode は保留にせずエンジンに任せる', async ($, on) => {
    setUp(on)

    const verdict = await $.tool.check({ tool: 'ExitPlanMode', input: {}, tool_use_id: 'plan-1' })
    expect(verdict).toEqual({ decision: 'ask' })
  })

  test('回答済みにするツール自身は確認なしで通す', async ($, on) => {
    setUp(on)

    const verdict = await $.tool.check({ tool: RESOLVE_TOOL, input: { no: 1, answer: 'A案' }, tool_use_id: 'r-1' })
    expect(verdict.decision).toBe('allow')
  })

  test('保留がなければ帯にボタンを描かない', async ($, on) => {
    setUp(on)

    const band = await mountBand($)
    expect(await band.find({ type: 'Button' })).toBeUndefined()
  })
})

describe('合言葉（帯を描けない Zed 等での操作）', () => {
  test('「!ok N」はそのプロンプトを承認の連絡に書き換え、次の同じ呼び出しを allow する', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await type($, '!ok 1')

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain(`承認（#1）: ${summarize('Bash', BASH_INPUT)}`)
    expect(submitted[0]).not.toContain('!ok')
    expect((await checkBash($, 'call-2')).decision).toBe('allow')
  })

  test('番号なしの「!ok」は一番新しい保留中の操作だけを承認する', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await checkWrite($, 'call-2')
    await type($, '!ok')

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('承認（#2）: Write: a.txt')
    expect(submitted[0]).not.toContain('#1')
    expect(await (await mountBand($)).find({ key: 'approve:1' })).toBeDefined()
  })

  test('番号なしの「!ok」は質問を対象にせず、質問より前の操作を承認する', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await askQuestions($, 'q-2')
    await type($, '!ok')

    expect(submitted[0]).toContain('承認（#1）')
  })

  test('番号なしの「!ng」は質問も含めて一番新しい保留を対象にする', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await askQuestions($, 'q-2')
    await type($, '!ng')

    expect(submitted[0]).toContain('質問の取り下げ（#2）')
    expect(submitted[0]).not.toContain('却下（#1）')
  })

  test('「!ng all」は保留中の操作と質問をすべて却下・取り下げる', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await checkWrite($, 'call-2')
    await askQuestions($, 'q-3')
    await type($, '!ng all')

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('却下（#1）')
    expect(submitted[0]).toContain('却下（#2）: Write: a.txt')
    expect(submitted[0]).toContain('質問の取り下げ（#3）')
    expect(await (await mountBand($)).find({ type: 'Button' })).toBeUndefined()
  })

  test('該当する保留がない合言葉はモデルに渡さず落とす', async ($, on) => {
    const submitted = setUp(on)

    expect(await type($, '!ok 9')).toEqual({ drop: expect.stringContaining('該当する保留中の操作がありません') })
    expect(await type($, '!ok')).toEqual({ drop: expect.stringContaining('該当する保留中の操作がありません') })
    expect(submitted).toHaveLength(0)
  })

  test('ターン中にボタンで溜めた連絡も、合言葉のプロンプトにまとめて載せる', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await checkWrite($, 'call-2')
    await $.turn.start({ text: '雑談', turnId: 'turn-1' })
    await (await mountBand($)).press({ key: 'reject:2' })
    await type($, '!ok 1')

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('却下（#2）')
    expect(submitted[0]).toContain('承認（#1）')

    await $.turn.complete({ ...TURN_END, turnId: 'turn-1' })
    expect(submitted).toHaveLength(1)
  })

  test('「!ok all」は保留中の操作だけを承認し、質問は残す', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await checkWrite($, 'call-2')
    await askQuestions($, 'q-3')
    await type($, '!ok all')

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('承認（#1）')
    expect(submitted[0]).toContain('承認（#2）: Write: a.txt')
    expect(submitted[0]).not.toContain('#3')
    expect(await (await mountBand($)).find({ key: 'withdraw:3' })).toBeDefined()
  })

  test('「!ok 1 2」は列挙した番号の操作をまとめて承認する', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await checkWrite($, 'call-2')
    await type($, '!ok 1 2')

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('承認（#1）')
    expect(submitted[0]).toContain('承認（#2）: Write: a.txt')
    expect((await checkBash($, 'call-3')).decision).toBe('allow')
    expect((await checkWrite($, 'call-4')).decision).toBe('allow')
  })

  test('「!ok N」で質問の番号を指すと落とす', async ($, on) => {
    const submitted = setUp(on)

    await askQuestions($, 'q-1')

    expect(await type($, '!ok 1')).toEqual({ drop: expect.stringContaining('該当する保留中の操作がありません') })
    expect(submitted).toHaveLength(0)
    expect(await (await mountBand($)).find({ key: 'withdraw:1' })).toBeDefined()
  })

  test('ユーザー以外が送ったプロンプトの合言葉は処理しない', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await type($, '!ok 1', { kind: 'task-notification' })

    expect(submitted).toEqual(['!ok 1'])
    expect((await checkBash($, 'call-2')).decision).toBe('deny')
  })

  test('ターミナルの入力（composer）でも使える', async ($, on) => {
    setUp(on)

    await checkBash($, 'call-1')
    await type($, '!ok 1', { kind: 'composer' })

    expect((await checkBash($, 'call-2')).decision).toBe('allow')
  })
})

describe('連絡の送信タイミング', () => {
  test('ターン中に押した連絡は溜めておき、ターン終了時に1件にまとめて送る', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await checkWrite($, 'call-2')
    await $.turn.start({ text: '雑談', turnId: 'turn-1' })

    const band = await mountBand($)
    await band.press({ key: 'approve:1' })
    await band.press({ key: 'reject:2' })
    expect(submitted).toHaveLength(0)

    await $.turn.complete({ ...TURN_END, turnId: 'turn-1' })
    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('承認（#1）: Bash')
    expect(submitted[0]).toContain('却下（#2）: Write: a.txt')
  })

  test('サブエージェントのターン終了では送らない', async ($, on) => {
    const submitted = setUp(on)

    await checkBash($, 'call-1')
    await $.turn.start({ text: '雑談', turnId: 'turn-1' })
    await (await mountBand($)).press({ key: 'approve:1' })

    await $.turn.complete({ ...TURN_END, turnId: 'sub-turn', agentId: 'agent-1' })
    expect(submitted).toHaveLength(0)
  })
})

describe('承認の有効期限', () => {
  test('再実行を依頼したターンで使われなかった承認は、ターン終了時に捨てる', async ($, on) => {
    setUp(on)

    await checkBash($, 'call-1')
    await type($, '!ok 1')
    await $.turn.start({ text: '承認の連絡', turnId: 'turn-1' })
    await $.turn.complete({ ...TURN_END, turnId: 'turn-1' })

    expect(await checkBash($, 'call-2')).toEqual({ decision: 'deny', reason: holdReason(2) })
  })

  test('ターン中にボタンで押した承認は、そのターンの終了では捨てず、次のターンで使える', async ($, on) => {
    setUp(on)

    await checkBash($, 'call-1')
    await $.turn.start({ text: '雑談', turnId: 'turn-1' })
    await (await mountBand($)).press({ key: 'approve:1' })
    await $.turn.complete({ ...TURN_END, turnId: 'turn-1' })

    await $.turn.start({ text: '承認の連絡', turnId: 'turn-2' })
    expect((await checkBash($, 'call-2')).decision).toBe('allow')
  })

  test('サブエージェントのターン終了では承認を捨てない', async ($, on) => {
    setUp(on)

    await checkBash($, 'call-1')
    await type($, '!ok 1')
    await $.turn.start({ text: '承認の連絡', turnId: 'turn-1' })
    await $.turn.complete({ ...TURN_END, turnId: 'sub-turn', agentId: 'agent-1' })

    expect((await checkBash($, 'call-2')).decision).toBe('allow')
  })
})

describe('AskUserQuestion', () => {
  test('質問を帯に表示し、モデルには会話に書き出して待つよう返す', async ($, on) => {
    setUp(on)

    expect(await askQuestions($, 'q-1')).toEqual({ deny: questionHoldReason(1) })

    const band = await mountBand($)
    expect(await band.find({ text: 'どの方式にする？' })).toBeDefined()
    expect(await band.find({ key: 'answer:1' })).toBeUndefined()
  })

  test('保留理由で、回答だと判断したら回答済みにするツールを呼ぶよう指示する', () => {
    expect(questionHoldReason(3)).toContain(`${RESOLVE_TOOL} を no: 3`)
  })

  test('回答済みにするツールを呼ぶと質問が保留から消え、連絡は送らない', async ($, on) => {
    const submitted = setUp(on)

    await askQuestions($, 'q-1')
    const result = await $.tool.call({ tool: RESOLVE_TOOL, tool_use_id: 'r-1', no: 1, answer: 'A案' })

    expect(result).toMatchObject({ result: '質問 #1 を回答済みにした' })
    expect(await (await mountBand($)).find({ key: 'withdraw:1' })).toBeUndefined()
    expect(submitted).toHaveLength(0)
  })

  test('回答済みにするツールで存在しない番号を指すと、その旨を返す', async ($, on) => {
    setUp(on)

    const result = await $.tool.call({ tool: RESOLVE_TOOL, tool_use_id: 'r-1', no: 5, answer: 'A案' })
    expect(result).toMatchObject({ result: '保留中の質問 #5 はない（回答済みか取り下げ済み）' })
  })

  test('全問に答えると送信でき、単一選択は押し直しで置き換え、複数選択は ON/OFF する', async ($, on) => {
    const submitted = setUp(on)

    await askQuestions($, 'q-1')
    const band = await mountBand($)

    await band.press({ key: 'option:1:0:0' })
    await band.press({ key: 'option:1:0:1' })
    expect(await band.find({ key: 'answer:1' })).toBeUndefined()

    await band.press({ key: 'option:1:1:0' })
    await band.press({ key: 'option:1:1:2' })
    await band.press({ key: 'option:1:1:0' })
    expect((await band.find({ key: 'option:1:1:2' }))?.text).toBe('✓ Z')

    await band.press({ key: 'answer:1' })
    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('「どの方式にする？」→ B案 / 「どれを有効にする？」→ Z')
    expect(await band.find({ key: 'withdraw:1' })).toBeUndefined()
  })

  test('取り下げると回答しない旨を送り、帯から消える', async ($, on) => {
    const submitted = setUp(on)

    await askQuestions($, 'q-1')
    const band = await mountBand($)
    await band.press({ key: 'withdraw:1' })

    expect(submitted).toHaveLength(1)
    expect(submitted[0]).toContain('質問の取り下げ（#1）: 「どの方式にする？」「どれを有効にする？」')
    expect(await band.find({ key: 'withdraw:1' })).toBeUndefined()
  })
})

describe('補助関数', () => {
  test('parseCommand は番号なし・番号の列挙・all・大文字を受け付け、それ以外は合言葉とみなさない', () => {
    expect(parseCommand('!ok')).toEqual({ action: 'ok', targets: 'latest' })
    expect(parseCommand(' !ng ')).toEqual({ action: 'ng', targets: 'latest' })
    expect(parseCommand('!ok 1')).toEqual({ action: 'ok', targets: [1] })
    expect(parseCommand('  !NG 2 10  ')).toEqual({ action: 'ng', targets: [2, 10] })
    expect(parseCommand('!ok all')).toEqual({ action: 'ok', targets: 'all' })
    expect(parseCommand('!okではだめなのかい？')).toBeUndefined()
    expect(parseCommand('!ok 1 してから続けて')).toBeUndefined()
    expect(parseCommand('ok 1')).toBeUndefined()
  })

  test('reRunInstruction は入力の JSON が500文字までなら載せ、超えたら載せない', () => {
    const input = (length: number) => ({ c: 'a'.repeat(length - '{"c":""}'.length) })
    expect(JSON.stringify(input(500))).toHaveLength(500)

    expect(reRunInstruction({ tool: 'Write', input: input(500) })).toContain(JSON.stringify(input(500)))
    expect(reRunInstruction({ tool: 'Write', input: input(501) })).toBe(
      '保留したときと同じ入力のまま Write を再実行すること（入力は保留時の呼び出しを参照）',
    )
  })

  test('summarize は対象を200文字で切り詰める', () => {
    expect(summarize('Bash', { command: 'a'.repeat(200) })).toBe(`Bash: ${'a'.repeat(200)}`)
    expect(summarize('Bash', { command: 'a'.repeat(201) })).toBe(`Bash: ${'a'.repeat(200)}…`)
  })

  test('summarize は対象のキーがなければ入力全体を JSON で表す', () => {
    expect(summarize('mcp__x__y', { id: 1 })).toBe('mcp__x__y: {"id":1}')
    expect(summarize('Tool', null)).toBe('Tool: null')
  })

  test('inputKeyOf はツール名でも区別する', () => {
    expect(inputKeyOf('Read', { file_path: 'a' })).not.toBe(inputKeyOf('Write', { file_path: 'a' }))
  })

  test('toggleSelection は単一選択なら置き換え、複数選択なら ON/OFF し、isAnswered は全問に選択があるときだけ true', () => {
    const single = QUESTIONS[0]!
    const multi = QUESTIONS[1]!
    expect(toggleSelection(single, ['A案'], 'B案')).toEqual(['B案'])
    expect(toggleSelection(multi, ['X'], 'Y')).toEqual(['X', 'Y'])
    expect(toggleSelection(multi, ['X', 'Y'], 'X')).toEqual(['Y'])

    expect(isAnswered({ id: 'q', no: 1, questions: QUESTIONS, selections: [['A案'], []] })).toBe(false)
    expect(isAnswered({ id: 'q', no: 1, questions: QUESTIONS, selections: [['A案'], ['X']] })).toBe(true)
  })
})
