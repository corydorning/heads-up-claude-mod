// Finds the question a reply ends on, for when Claude forgot to log it. Pure: no `$`.

const MAX_LENGTH = 160

/** The last question in the reply's final paragraph, as plain one-line text; undefined when there is none. */
export function trailingQuestion(reply: string): string | undefined {
  const prose = reply.replace(/```[\s\S]*?(```|$)/g, '').trim()
  const lastParagraph = prose.split(/\n\s*\n/).pop() ?? ''
  const plain = lastParagraph
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    // A question inside quotes is quoted (an item's title, say), not asked.
    .replace(/"[^"\n]*"|“[^”\n]*”/g, '')
    .replace(/[*_`]/g, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()

  const sentences = plain.match(/[^.!?]*\?/g)
  const question = sentences?.pop()?.trim()

  if (!question || question.length < 8) {
    return undefined
  }

  return question.length > MAX_LENGTH ? `${question.slice(0, MAX_LENGTH - 4).trimEnd()}...?` : question
}
