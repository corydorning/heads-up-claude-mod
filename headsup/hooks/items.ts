// Pure list logic: no `$`, so it is easy to test and reason about.
import type { Item, ItemKind } from '../types'

export const MAX_ITEMS = 200
export const DONE_TTL_MS = 7 * 24 * 60 * 60 * 1000

export const KIND_ORDER: readonly ItemKind[] = ['question', 'followup', 'failure', 'note']

export const KIND_LABEL: Record<ItemKind, [string, string]> = {
  question: ['question', 'questions'],
  followup: ['follow-up', 'follow-ups'],
  failure: ['failure', 'failures'],
  note: ['note', 'notes'],
}

export function makeId(now: number): string {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

export function add(items: readonly Item[], item: Item): Item[] {
  return prune([...items.filter(one => one.id !== item.id), item], item.createdAt)
}

/** Adds a failure unless an open one with the same fingerprint exists in this session. */
export function addFailure(items: readonly Item[], item: Item): Item[] {
  const isRepeat = items.some(
    one =>
      one.status === 'open' &&
      one.kind === 'failure' &&
      one.session === item.session &&
      one.fingerprint === item.fingerprint,
  )

  return isRepeat ? [...items] : add(items, item)
}

export function resolve(items: readonly Item[], ids: readonly string[], now: number): Item[] {
  const wanted = new Set(ids)

  return items.map(one =>
    wanted.has(one.id) && one.status === 'open' ? { ...one, status: 'done', doneAt: now } : one,
  )
}

/** Closes this session's open failures with the fingerprint (the same command later succeeded). */
export function resolveFingerprint(
  items: readonly Item[],
  session: string,
  fingerprint: string,
  now: number,
): Item[] {
  const ids = items
    .filter(
      one =>
        one.status === 'open' &&
        one.kind === 'failure' &&
        one.session === session &&
        one.fingerprint === fingerprint,
    )
    .map(one => one.id)

  return ids.length === 0 ? [...items] : resolve(items, ids, now)
}

/** Drops done items past their TTL, then the oldest beyond the cap (done ones first). */
export function prune(items: readonly Item[], now: number): Item[] {
  const kept = items.filter(one => one.status === 'open' || now - (one.doneAt ?? now) < DONE_TTL_MS)

  if (kept.length <= MAX_ITEMS) {
    return kept
  }

  const ranked = [...kept].sort(
    (a, b) => Number(a.status === 'open') - Number(b.status === 'open') || a.createdAt - b.createdAt,
  )
  const dropped = new Set(ranked.slice(0, kept.length - MAX_ITEMS).map(one => one.id))

  return kept.filter(one => !dropped.has(one.id))
}

export function openItems(items: readonly Item[]): Item[] {
  return items.filter(one => one.status === 'open')
}

export function counts(items: readonly Item[]): Record<ItemKind, number> {
  const tally: Record<ItemKind, number> = { question: 0, followup: 0, failure: 0, note: 0 }

  for (const one of openItems(items)) {
    tally[one.kind] += 1
  }

  return tally
}

/** "1 question · 2 follow-ups", kinds with none left out. */
export function summary(items: readonly Item[]): string {
  const tally = counts(items)

  return KIND_ORDER.filter(kind => tally[kind] > 0)
    .map(kind => `${tally[kind]} ${KIND_LABEL[kind][tally[kind] === 1 ? 0 : 1]}`)
    .join(' · ')
}

/** Items of one kind, blocking ones first, then newest first. */
export function ofKind(items: readonly Item[], kind: ItemKind): Item[] {
  return items
    .filter(one => one.kind === kind)
    .sort((a, b) => Number(b.blocking === true) - Number(a.blocking === true) || b.createdAt - a.createdAt)
}

/** Open questions Claude is stuck on until the user answers. */
export function blockingCount(items: readonly Item[]): number {
  return openItems(items).filter(one => one.blocking === true).length
}

/** Plain-text listing, for the tool's `list` and the /headsup fallback. */
export function listing(items: readonly Item[]): string {
  const open = openItems(items)

  if (open.length === 0) {
    return 'Nothing needs attention.'
  }

  return KIND_ORDER.flatMap(kind => {
    const group = ofKind(open, kind)

    return group.length === 0
      ? []
      : [
          `${KIND_LABEL[kind][1]}:`,
          ...group.map(one => `  [${one.id}] ${one.text}${one.blocking ? ' (blocking)' : ''} (${one.folder})`),
        ]
  }).join('\n')
}

export function isItemList(value: unknown): value is Item[] {
  return (
    Array.isArray(value) &&
    value.every(
      one =>
        typeof one === 'object' &&
        one !== null &&
        typeof (one as Item).id === 'string' &&
        typeof (one as Item).text === 'string' &&
        KIND_ORDER.includes((one as Item).kind),
    )
  )
}

/** A stored conversation row, as much of it as `claudeTextUuid` reads. */
type AppendedRow = {
  agentId?: string
  door: string
  uuid: string
  message: { type: string; content?: unknown }
}

/** The row's id when it is Claude's own text in the main conversation; undefined for anything else. */
export function claudeTextUuid(row: AppendedRow): string | undefined {
  const content = row.message.content
  const hasText =
    Array.isArray(content) &&
    content.some(
      block =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        String((block as { text?: unknown }).text ?? '').trim() !== '',
    )

  return row.agentId === undefined && row.door === 'response' && row.message.type === 'assistant' && hasText
    ? row.uuid
    : undefined
}

/**
 * The session's link, carrying the message the item was raised in. No parameter for it is documented,
 * so it rides under the likely names; a page that reads none of them opens the session as before.
 */
export function goLink(base: string, messageUuid: string | undefined): string {
  if (messageUuid === undefined) {
    return base
  }

  const at = encodeURIComponent(messageUuid)

  return `${base}?message=${at}&messageUuid=${at}&uuid=${at}`
}
