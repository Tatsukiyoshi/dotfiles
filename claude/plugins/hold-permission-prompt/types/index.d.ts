/** 確認待ちとして保留した操作 */
export type HeldCall = {
  id: string
  /** 合言葉（!ok N / !ng N）で指す通し番号 */
  no: number
  tool: string
  input: unknown
  inputKey: string
  summary: string
}

export type HeldQuestionItem = {
  question: string
  header: string
  options: { label: string; description: string }[]
  multiSelect: boolean
}

/** 帯に表示中の AskUserQuestion。selections は質問ごとに選ばれた選択肢のラベル */
export type HeldQuestion = {
  id: string
  no: number
  questions: HeldQuestionItem[]
  selections: string[][]
}

declare module 'claude-code' {
  interface PluginState {
    'hold-permission-prompt': {
      calls: HeldCall[]
      questions: HeldQuestion[]
      /** 1回分だけ承認済みの操作（inputKey） */
      approvals: string[]
      /** 実行中のターンで再実行を依頼した承認（inputKey）。ターン終了時に使われずに残っていれば捨てる */
      deliveredApprovals: string[]
      /** ターン終了時にまとめてモデルへ送る連絡 */
      outbox: string[]
      isWorking: boolean
      /** 最後に振った通し番号 */
      seq: number
    }
  }
}
