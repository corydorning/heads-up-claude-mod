export type ItemKind = 'question' | 'followup' | 'failure' | 'note'

export type ItemStatus = 'open' | 'done'

export type Item = {
  id: string
  kind: ItemKind
  text: string
  detail?: string
  /** Short id of the session that raised it. */
  session: string
  /** Folder name of that session, shown on items from other sessions. */
  folder: string
  createdAt: number
  status: ItemStatus
  doneAt?: number
  /** Questions only: Claude cannot continue until the user answers. */
  blocking?: boolean
  /** Failures only: what identifies a repeat of the same failure. */
  fingerprint?: string
}

declare module 'claude-code' {
  interface PluginState {
    attention: { items: Item[]; showDone: boolean; answering: string | null }
  }
}
