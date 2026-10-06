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

test('ignores question marks inside quotes, such as a quoted item title', () => {
  expect(
    trailingQuestion('The reply part of the test is still open: type a reply under "Test question: is Heads Up working?" and press Enter.'),
  ).toBeUndefined()
  expect(trailingQuestion('To finish: click Go on “Is it working?”. The app should switch.')).toBeUndefined()
  // A real question that also quotes one is still found.
  expect(trailingQuestion('I logged "Ready to ship?" for you. Want me to wait for it?')).toBe('Want me to wait for it?')
})
