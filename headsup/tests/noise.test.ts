import { expect, test } from 'claude-code/testing'

import { isNoise } from '../hooks/noise'

const exit1 = 'Exit code 1\n'

test('a search or check that answers "no" with exit 1 is noise', () => {
  expect(isNoise('grep -rn TODO src', exit1)).toBe(true)
  expect(isNoise('rg foo', exit1)).toBe(true)
  expect(isNoise('cat package.json | grep react', exit1)).toBe(true)
  expect(isNoise('which tsc', 'Exit code 1\ntsc not found')).toBe(true)
  expect(isNoise('cd src && grep -q x file.ts', exit1)).toBe(true)
  expect(isNoise('test -f .env', exit1)).toBe(true)
  expect(isNoise('[ -d build ]', exit1)).toBe(true)
  expect(isNoise('git diff --quiet', exit1)).toBe(true)
  expect(isNoise('git grep needle', exit1)).toBe(true)
  expect(isNoise('LC_ALL=C grep x f', exit1)).toBe(true)
})

test('a real error is never noise', () => {
  // Exit 2+ is an error for these commands.
  expect(isNoise('grep foo missing.txt', 'Exit code 2\ngrep: missing.txt: No such file or directory')).toBe(false)
  // A non-lookup step could be what failed.
  expect(isNoise('npm test && grep PASS out.log', exit1)).toBe(false)
  expect(isNoise('npm test', exit1)).toBe(false)
  expect(isNoise('git diff', exit1)).toBe(false)
  // Error wording in the output.
  expect(isNoise('cat missing | grep x', 'Exit code 1\ncat: missing: No such file or directory')).toBe(false)
  expect(isNoise('grep x f', 'Exit code 1\nPermission denied')).toBe(false)
  // No exit code to go on.
  expect(isNoise('grep x f', 'Command timed out')).toBe(false)
  expect(isNoise('grep x f', undefined)).toBe(false)
})
