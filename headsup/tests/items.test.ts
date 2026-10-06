import { expect, test } from 'claude-code/testing'

import { askedAt, MAX_ITEMS, DONE_TTL_MS, add, addFailure, blockingCount, counts, ofKind, prune, resolve, resolveFingerprint, summary } from '../hooks/items'
import type { Item } from '../types'

const item = (over: Partial<Item>): Item => ({
  id: 'x',
  kind: 'note',
  text: 't',
  session: 's1',
  folder: 'f',
  createdAt: 1000,
  status: 'open',
  ...over,
})

test('summary counts open items by kind and skips empty kinds', () => {
  const items = [
    item({ id: 'a', kind: 'question' }),
    item({ id: 'b', kind: 'followup' }),
    item({ id: 'c', kind: 'followup' }),
    item({ id: 'd', kind: 'note', status: 'done', doneAt: 2000 }),
  ]
  expect(summary(items)).toBe('1 question · 2 follow-ups')
  expect(counts(items).note).toBe(0)
})

test('a repeated open failure in the same session is not added twice', () => {
  const first = addFailure([], item({ id: 'a', kind: 'failure', fingerprint: 'Bash:false' }))
  const again = addFailure(first, item({ id: 'b', kind: 'failure', fingerprint: 'Bash:false' }))
  const other = addFailure(again, item({ id: 'c', kind: 'failure', fingerprint: 'Bash:false', session: 's2' }))
  expect(again).toHaveLength(1)
  expect(other).toHaveLength(2)
})

test('resolve and resolveFingerprint close only matching open items', () => {
  const items = [
    item({ id: 'a', kind: 'failure', fingerprint: 'fp' }),
    item({ id: 'b', kind: 'failure', fingerprint: 'fp', session: 's2' }),
    item({ id: 'c' }),
  ]
  const fixed = resolveFingerprint(items, 's1', 'fp', 5000)
  expect(fixed.map(one => one.status)).toEqual(['done', 'open', 'open'])
  expect(resolve(fixed, ['c'], 6000)[2]).toMatchObject({ status: 'done', doneAt: 6000 })
})

test('prune drops expired done items and caps the list, done ones first', () => {
  const expired = item({ id: 'old', status: 'done', doneAt: 0 })
  expect(prune([expired], DONE_TTL_MS + 1)).toHaveLength(0)

  const many = Array.from({ length: MAX_ITEMS }, (_, i) => item({ id: `o${i}`, createdAt: i }))
  const withDone = add([...many, item({ id: 'd', status: 'done', doneAt: 10, createdAt: 5 })], item({ id: 'new', createdAt: 999 }))
  expect(withDone).toHaveLength(MAX_ITEMS)
  expect(withDone.some(one => one.id === 'd')).toBe(false)
  expect(withDone.some(one => one.id === 'new')).toBe(true)
})

test('blocking questions sort first and lead the summary', () => {
  const items = [
    item({ id: 'a', kind: 'question', createdAt: 3 }),
    item({ id: 'b', kind: 'question', createdAt: 1, blocking: true }),
    item({ id: 'c', kind: 'followup' }),
  ]
  expect(ofKind(items, 'question').map(one => one.id)).toEqual(['b', 'a'])
  expect(blockingCount(items)).toBe(1)
  expect(summary(items)).toBe('2 questions · 1 follow-up')
  expect(blockingCount([item({ kind: 'question', blocking: true, status: 'done', doneAt: 5 })])).toBe(0)
})

test('askedAt says Today or Yesterday, else the date, and the year when it is not this year', () => {
  const now = new Date(2026, 9, 6, 17, 30).getTime()
  expect(askedAt(new Date(2026, 9, 6, 9, 5).getTime(), now)).toBe('Today, 9:05 AM')
  expect(askedAt(new Date(2026, 9, 5, 21, 0).getTime(), now)).toBe('Yesterday, 9:00 PM')
  expect(askedAt(new Date(2026, 9, 4, 0, 30).getTime(), now)).toBe('Oct 4, 12:30 AM')
  expect(askedAt(new Date(2025, 11, 31, 12, 0).getTime(), now)).toBe('Dec 31, 2025, 12:00 PM')
  // Yesterday across a month and year boundary.
  expect(askedAt(new Date(2025, 11, 31, 8, 0).getTime(), new Date(2026, 0, 1, 9, 0).getTime())).toBe('Yesterday, 8:00 AM')
})
