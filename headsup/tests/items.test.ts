import { expect, test } from 'claude-code/testing'

import { claudeTextUuid, goLink, MAX_ITEMS, DONE_TTL_MS, add, addFailure, blockingCount, counts, ofKind, prune, resolve, resolveFingerprint, summary } from '../hooks/items'
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

test('claudeTextUuid picks only Claude\'s own text in the main conversation', () => {
  const text = { type: 'assistant', content: [{ type: 'text', text: 'Deploy now?' }] }
  expect(claudeTextUuid({ door: 'response', uuid: 'a', message: text })).toBe('a')
  expect(claudeTextUuid({ door: 'response', uuid: 'b', agentId: 'sub', message: text })).toBeUndefined()
  expect(claudeTextUuid({ door: 'prompt', uuid: 'c', message: { type: 'user', content: [{ type: 'text', text: 'hi' }] } })).toBeUndefined()
  expect(
    claudeTextUuid({ door: 'response', uuid: 'd', message: { type: 'assistant', content: [{ type: 'tool_use', id: 't' }] } }),
  ).toBeUndefined()
})

test('goLink adds the message under each likely name, and leaves a link without one alone', () => {
  expect(goLink('claude://x/s', undefined)).toBe('claude://x/s')
  expect(goLink('claude://x/s', 'm 1')).toBe('claude://x/s?message=m%201&messageUuid=m%201&uuid=m%201')
})
