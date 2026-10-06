export type ItemKind = 'question' | 'followup' | 'failure' | 'note'

export type ItemStatus = 'open' | 'done'

export type Item = {
  id: string
  kind: ItemKind
  text: string
  detail?: string
  /** Short id of the session that raised it. */
  session: string
  /** Full id of that session, for sending it replies; absent on items from before it was recorded. */
  sessionId?: string
  /** The desktop app's link to that session; absent for terminal and remote sessions. */
  link?: string
  /** Folder name of that session, shown on items from other sessions. */
  folder: string
  createdAt: number
  status: ItemStatus
  doneAt?: number
  /** When the user's reply was sent; the item waits for Claude to act on it and close it. */
  repliedAt?: number
  /** Questions only: Claude cannot continue until the user answers. */
  blocking?: boolean
  /** Failures only: what identifies a repeat of the same failure. */
  fingerprint?: string
}

declare module 'claude-code' {
  interface PluginState {
    attention: { items: Item[]; showDone: boolean; drafts: Record<string, string> }
  }
}
