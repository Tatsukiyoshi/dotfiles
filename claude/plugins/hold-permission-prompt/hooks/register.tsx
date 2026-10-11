import { atom, read, update } from 'claude-code'
import type { EngineInterface, PromptOrigin, Register } from 'claude-code'

import type { HeldCall, HeldQuestion, HeldQuestionItem } from '../types'

const PLUGIN = 'hold-permission-prompt'

// $.state の参照は plugin・key とも文字列リテラルで書く必要がある（claude plugin validate の要件）
const calls = atom({ plugin: 'hold-permission-prompt', key: 'calls' } as const, [] as HeldCall[])
const questions = atom({ plugin: 'hold-permission-prompt', key: 'questions' } as const, [] as HeldQuestion[])
const approvals = atom({ plugin: 'hold-permission-prompt', key: 'approvals' } as const, [] as string[])
const outbox = atom({ plugin: 'hold-permission-prompt', key: 'outbox' } as const, [] as string[])
const isWorking = atom({ plugin: 'hold-permission-prompt', key: 'isWorking' } as const, false)
const seq = atom({ plugin: 'hold-permission-prompt', key: 'seq' } as const, 0)

// ユーザーの確認が必須のツールは hook の allow でダイアログを閉じられないため、保留せずエンジンに任せる
const PASS_THROUGH_TOOLS = new Set(['ExitPlanMode'])

// 合言葉を受け付けるのはユーザー自身の入力（ターミナル・Zed 等の SDK ホスト・Remote Control）だけ
const USER_ORIGINS = new Set<PromptOrigin['kind']>(['composer', 'sdk', 'bridge'])

// 番号を省くと一番新しい保留を指す
const COMMAND_PATTERN = /^!(ok|ng)((?:\s+(?:\d+|all))*)\s*$/i

// モデルがユーザーの入力を読んで質問への回答だと判断したときに呼ぶツール。回答されたかどうかは Mod からは判断できないため
const RESOLVE_TOOL_NAME = 'resolve_question'
export const RESOLVE_TOOL = `mcp__${PLUGIN}__${RESOLVE_TOOL_NAME}`

const SUMMARY_LIMIT = 200

// 承認の連絡に入力の JSON を載せる上限。超えたら載せない（Write のファイル内容が丸ごと会話に流れるため）
const INPUT_ECHO_LIMIT = 500

export function holdReason(no: number): string {
  return (
    `保留（#${no}）: この操作はユーザーの承認待ちにした。` +
    `ユーザーに保留中の操作の内容と、承認は「!ok ${no}」、却下は「!ng ${no}」と入力すればよいことを短く伝えること。` +
    '承認されると再実行の依頼が届くので、それまで同じ操作を再試行せず、ほかの作業か会話を続けること。'
  )
}

export function questionHoldReason(no: number): string {
  return (
    `保留（#${no}）: 質問を入力欄の上の帯に表示した。帯を表示できないクライアント（Zed 等）もあるため、` +
    '質問と選択肢を番号付きでそのまま会話に書き出してから、ユーザーの回答を待つこと。' +
    `ユーザーは普通に入力して回答する（取り下げは「!ng ${no}」）。回答を推測しないこと。` +
    `ユーザーの入力を読んで質問 #${no} への回答だと判断したら、${RESOLVE_TOOL} を no: ${no} と回答の要約で呼び、回答済みにすること。` +
    '回答でない入力（雑談等）のときは呼ばないこと。'
  )
}

export function inputKeyOf(tool: string, input: unknown): string {
  return `${tool}:${JSON.stringify(input)}`
}

export function summarize(tool: string, input: unknown): string {
  const record = (typeof input === 'object' && input !== null ? input : {}) as Record<string, unknown>
  const target = record.command ?? record.file_path ?? record.notebook_path ?? record.url ?? record.pattern
  const text = typeof target === 'string' ? target : JSON.stringify(input)

  return `${tool}: ${text.length > SUMMARY_LIMIT ? `${text.slice(0, SUMMARY_LIMIT)}…` : text}`
}

export function isAnswered(held: HeldQuestion): boolean {
  return held.questions.every((_, i) => (held.selections[i] ?? []).length > 0)
}

export function toggleSelection(item: HeldQuestionItem, selected: readonly string[], label: string): string[] {
  if (!item.multiSelect) {
    return [label]
  }

  return selected.includes(label) ? selected.filter(l => l !== label) : [...selected, label]
}

/** 「!ok」「!ok 1 2」「!ng all」を解釈する。合言葉でなければ undefined */
export function parseCommand(
  text: string,
): { action: 'ok' | 'ng'; targets: number[] | 'all' | 'latest' } | undefined {
  const match = COMMAND_PATTERN.exec(text.trim())

  if (match === null) {
    return undefined
  }

  const words = (match[2] ?? '').trim().split(/\s+/).filter(w => w !== '')
  const action = (match[1] ?? '').toLowerCase() === 'ok' ? 'ok' : 'ng'

  if (words.length === 0) {
    return { action, targets: 'latest' }
  }

  return { action, targets: words.some(w => w.toLowerCase() === 'all') ? 'all' : words.map(Number) }
}

async function nextNo($: EngineInterface): Promise<number> {
  let no = 0
  await update($, seq, n => {
    no = n + 1
    return no
  })
  return no
}

// ボタン・合言葉の処理は描画時の値でなく、その時点の状態から取り出す（二度押しで二重に連絡しないため）
async function takeCall($: EngineInterface, no: number): Promise<HeldCall | undefined> {
  let taken: HeldCall | undefined
  await update($, calls, list => {
    taken = list.find(c => c.no === no)
    return list.filter(c => c.no !== no)
  })
  return taken
}

async function takeQuestion($: EngineInterface, no: number): Promise<HeldQuestion | undefined> {
  let taken: HeldQuestion | undefined
  await update($, questions, list => {
    taken = list.find(q => q.no === no)
    return list.filter(q => q.no !== no)
  })
  return taken
}

/** 合言葉の対象の番号。!ok は操作だけ、!ng は操作と質問の両方が対象 */
async function resolveTargets(
  $: EngineInterface,
  action: 'ok' | 'ng',
  targets: number[] | 'all' | 'latest',
): Promise<number[]> {
  if (Array.isArray(targets)) {
    return targets
  }

  const held = [
    ...(await read($, calls)).map(c => c.no),
    ...(action === 'ng' ? (await read($, questions)).map(q => q.no) : []),
  ]

  if (targets === 'all' || held.length === 0) {
    return held
  }

  return [Math.max(...held)]
}

/** 承認して、モデルへの連絡を返す。対象がなければ undefined */
async function approve($: EngineInterface, no: number): Promise<string | undefined> {
  const call = await takeCall($, no)

  if (call === undefined) {
    return undefined
  }

  await update($, approvals, list => [...list, call.inputKey])
  return `承認（#${no}）: ${call.summary}\n  ${reRunInstruction(call)}`
}

/** 再実行の依頼。長い入力（Write のファイル内容等）は連絡に載せず、保留時の呼び出しを参照させる */
export function reRunInstruction(call: Pick<HeldCall, 'tool' | 'input'>): string {
  const json = JSON.stringify(call.input)

  return json.length > INPUT_ECHO_LIMIT
    ? `保留したときと同じ入力のまま ${call.tool} を再実行すること（入力は保留時の呼び出しを参照）`
    : `次の入力のまま ${call.tool} を再実行すること: ${json}`
}

/** 却下（質問なら取り下げ）して、モデルへの連絡を返す。対象がなければ undefined */
async function reject($: EngineInterface, no: number): Promise<string | undefined> {
  const call = await takeCall($, no)

  if (call !== undefined) {
    return `却下（#${no}）: ${call.summary}\n  この操作は実行しないこと`
  }

  const held = await takeQuestion($, no)

  if (held !== undefined) {
    return `質問の取り下げ（#${no}）: 「${held.questions.map(q => q.question).join('」「')}」には回答しない`
  }

  return undefined
}

async function answer($: EngineInterface, no: number): Promise<string | undefined> {
  const held = await takeQuestion($, no)

  if (held === undefined) {
    return undefined
  }

  const answers = held.questions.map((q, i) => `「${q.question}」→ ${(held.selections[i] ?? []).join(', ')}`)
  return `質問への回答（#${no}）: ${answers.join(' / ')}`
}

function formatNotice(lines: readonly string[]): string {
  return `${PLUGIN} からの連絡:\n${lines.map(l => `- ${l}`).join('\n')}`
}

async function drainOutbox($: EngineInterface): Promise<string[]> {
  let lines: string[] = []
  await update($, outbox, list => {
    lines = list
    return []
  })
  return lines
}

async function flush($: EngineInterface) {
  const lines = await drainOutbox($)

  if (lines.length > 0) {
    await $.prompt.submit({ text: formatNotice(lines) })
  }
}

// ターン中に押されたボタンの連絡は溜めておき、ターンが終わったときにまとめて送る
async function send($: EngineInterface, line: string | undefined) {
  if (line === undefined) {
    return
  }

  await update($, outbox, list => [...list, line])

  if (!(await read($, isWorking))) {
    await flush($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: RESOLVE_TOOL_NAME,
      description:
        `${PLUGIN} が保留にした AskUserQuestion の質問を回答済みにする。` +
        'ユーザーの入力を読んで、その質問への回答だと判断したときだけ呼ぶ（雑談等では呼ばない）。',
      inputSchema: {
        type: 'object',
        properties: {
          no: { type: 'integer', description: '保留の通し番号（保留（#N）の N）' },
          answer: { type: 'string', description: 'ユーザーの回答の要約' },
        },
        required: ['no', 'answer'],
      },
      isDeferred: false,
    })

    return next(e)
  })

  on('tool.call', { tool: RESOLVE_TOOL }, async ($, e) => {
    const no = Number((e as { no?: unknown }).no)
    const held = await takeQuestion($, no)

    return {
      result:
        held === undefined
          ? `保留中の質問 #${no} はない（回答済みか取り下げ済み）`
          : `質問 #${no} を回答済みにした`,
    }
  })

  on('turn.start', async ($, e, next) => {
    await update($, isWorking, () => true)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      await update($, isWorking, () => false)
      await flush($)
    }

    return result
  })

  // 合言葉の入力は、そのプロンプト自体を承認・却下の連絡に書き換えてモデルに渡す（帯を描けない Zed 等でも操作できるように）
  on('prompt.submit', async ($, e, next) => {
    const command = USER_ORIGINS.has(e.origin.kind) ? parseCommand(e.text) : undefined

    if (command === undefined) {
      return next(e)
    }

    const lines: string[] = []

    for (const no of await resolveTargets($, command.action, command.targets)) {
      const line = command.action === 'ok' ? await approve($, no) : await reject($, no)

      if (line !== undefined) {
        lines.push(line)
      }
    }

    if (lines.length === 0) {
      return { drop: `${PLUGIN}: 該当する保留中の操作がありません（${e.text.trim()}）` }
    }

    return next({ ...e, text: formatNotice([...(await drainOutbox($)), ...lines]) })
  })

  on('tool.check', async ($, e, next) => {
    // 回答済みにするツールが保留されると質問がいつまでも残るため、確認なしで通す
    if (e.tool === RESOLVE_TOOL) {
      return { decision: 'allow', reason: `${PLUGIN}: 自身のツール` }
    }

    const verdict = await next(e)

    if (verdict.decision !== 'ask' || e.tool_use_id === undefined || PASS_THROUGH_TOOLS.has(e.tool)) {
      return verdict
    }

    const inputKey = inputKeyOf(e.tool, e.input)
    let isApproved = false
    await update($, approvals, list => {
      isApproved = list.includes(inputKey)
      return isApproved ? list.filter(k => k !== inputKey) : list
    })

    if (isApproved) {
      return { decision: 'allow', reason: `${PLUGIN}: 承認済み` }
    }

    const existing = (await read($, calls)).find(c => c.inputKey === inputKey)

    if (existing !== undefined) {
      return { decision: 'deny', reason: holdReason(existing.no) }
    }

    const no = await nextNo($)
    const held: HeldCall = {
      id: e.tool_use_id,
      no,
      tool: e.tool,
      input: e.input,
      inputKey,
      summary: summarize(e.tool, e.input),
    }
    await update($, calls, list => [...list, held])

    return { decision: 'deny', reason: holdReason(no) }
  }).catch(($, e, next) => next(e)) // 保留に失敗したときはエンジンのダイアログに任せる

  on('tool.call', { tool: 'AskUserQuestion' }, async ($, e) => {
    const no = await nextNo($)
    const held: HeldQuestion = {
      id: e.tool_use_id ?? `question-${no}`,
      no,
      questions: e.questions.map(q => ({
        question: q.question,
        header: q.header,
        options: q.options.map(o => ({ label: o.label, description: o.description })),
        multiSelect: q.multiSelect,
      })),
      selections: e.questions.map(() => []),
    }
    await update($, questions, list => [...list, held])

    return { deny: questionHoldReason(no) }
  }).catch(($, e, next) => next(e)) // 保留に失敗したときはエンジンのダイアログに任せる

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const heldCalls = await read($, calls)
    const heldQuestions = await read($, questions)

    if (e.props.hasSurvey || (heldCalls.length === 0 && heldQuestions.length === 0)) {
      return next(e)
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    const choose = (no: number, index: number, label: string) =>
      update($, questions, list =>
        list.map(q => {
          const item = q.questions[index]

          if (q.no !== no || item === undefined) {
            return q
          }

          const selections = q.selections.map((s, i) => (i === index ? toggleSelection(item, s, label) : s))
          return { ...q, selections }
        }),
      )

    return (
      <Box flexDirection="column">
        {heldCalls.map(call => (
          <Box key={`call:${call.no}`} flexDirection="row" gap={1}>
            <Text color="permission">保留中 #{call.no}</Text>
            <Text wrap="truncate-end">{call.summary}</Text>
            <Button key={`approve:${call.no}`} label="承認" variant="primary" onPress={async () => send($, await approve($, call.no))} />
            <Button key={`reject:${call.no}`} label="却下" onPress={async () => send($, await reject($, call.no))} />
          </Box>
        ))}
        {heldQuestions.map(held => (
          <Box key={`question:${held.no}`} flexDirection="column">
            {held.questions.map((item, index) => (
              <Box key={`item:${held.no}:${index}`} flexDirection="row" flexWrap="wrap" gap={1}>
                <Text color="permission">#{held.no} [{item.header}]</Text>
                <Text>{item.question}</Text>
                {item.options.map((option, optionIndex) => (
                  <Button
                    key={`option:${held.no}:${index}:${optionIndex}`}
                    label={`${(held.selections[index] ?? []).includes(option.label) ? '✓ ' : ''}${option.label}`}
                    onPress={() => choose(held.no, index, option.label)}
                  />
                ))}
              </Box>
            ))}
            <Box flexDirection="row" gap={1}>
              {isAnswered(held) && (
                <Button key={`answer:${held.no}`} label="回答を送信" variant="primary" onPress={async () => send($, await answer($, held.no))} />
              )}
              <Button key={`withdraw:${held.no}`} label="取り下げ" onPress={async () => send($, await reject($, held.no))} />
            </Box>
          </Box>
        ))}
        <Text dimColor>ボタンは ctrl+x → tab で選べます。入力欄に「!ok」「!ng」（番号を付けるとその保留、all で全件）と打っても操作できます</Text>
      </Box>
    )
  })
}
