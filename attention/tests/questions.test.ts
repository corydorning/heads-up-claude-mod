import { expect, test } from 'claude-code/testing'

import { trailingQuestion } from '../hooks/questions'

test('finds the question that ends a reply', () => {
  expect(trailingQuestion('All done.\n\nWant me to log the test question, or build any of these?')).toBe(
    'Want me to log the test question, or build any of these?',
  )
  expect(trailingQuestion('Built it. Should I use **Postgres** or `SQLite`? Either works.')).toBe(
    'Should I use Postgres or SQLite?',
  )
})

test('ignores questions that do not end the reply', () => {
  expect(trailingQuestion('Why did it fail? The cache was stale.\n\nFixed and tests pass.')).toBeUndefined()
  expect(trailingQuestion('```js\nconst ok = a ? b : c\n```')).toBeUndefined()
  expect(trailingQuestion('See https://example.com/?q=1')).toBeUndefined()
  expect(trailingQuestion('')).toBeUndefined()
})

test('keeps long questions to one line', () => {
  const long = `Should I ${'really '.repeat(40)}do it?`
  expect(trailingQuestion(long)!.length).toBeLessThanOrEqual(160)
})
