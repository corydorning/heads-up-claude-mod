// Which failed shell commands are not worth the user's attention. Pure: no `$`.
//
// Noise only when all of these hold:
// - the exit code is exactly 1, which for search and check commands means "no match" or
//   "false"; 2 and up is a real error for them;
// - every step of the command is such a search or check (or `cd`), so the 1 cannot have
//   come from something else, as in `npm test && grep ...`;
// - nothing in the output reads like an error.

const LOOKUPS = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'pgrep',
  'which', 'type', 'test', '[', '[[',
  'diff', 'cmp',
])

const ERROR_WORDS =
  /no such file|not a directory|permission denied|operation not permitted|invalid|illegal|unrecognized|unknown option|usage:|syntax error|error|fatal|cannot|can't|failed/i

export function isNoise(command: string, text: string | undefined): boolean {
  if (text === undefined || exitCode(text) !== 1) {
    return false
  }

  const output = text.replace(/^\s*Exit code \d+\s*/i, '')

  if (ERROR_WORDS.test(output)) {
    return false
  }

  const steps = command.split(/&&|\|\||;|\n/).map(step => step.trim()).filter(Boolean)

  return steps.length > 0 && steps.every(isLookupStep)
}

function exitCode(text: string): number | undefined {
  const match = /^\s*Exit code (\d+)/i.exec(text)

  return match ? Number(match[1]) : undefined
}

/** A chain step whose exit status is a lookup's: for a pipe, its last stage (no pipefail). */
function isLookupStep(step: string): boolean {
  const last = step.split('|').pop()?.trim() ?? ''
  const words = last.split(/\s+/).filter(word => !/^\w+=/.test(word))
  const [name, sub] = words

  if (name === undefined) {
    return false
  }

  if (name === 'cd' || LOOKUPS.has(name)) {
    return true
  }

  if (name === 'command') {
    return sub === '-v' || sub === '-V'
  }

  if (name === 'git') {
    return sub === 'grep' || (sub === 'diff' && words.some(w => w === '--quiet' || w === '--exit-code'))
  }

  return false
}
