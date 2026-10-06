import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Item, ItemKind } from '../types'
import {
  KIND_LABEL,
  KIND_ORDER,
  add,
  addFailure,
  blockingCount,
  isItemList,
  listing,
  makeId,
  ofKind,
  openItems,
  resolve,
  resolveFingerprint,
  summary,
} from './items'
import { isNoise } from './noise'
import { trailingQuestion } from './questions'

const PANE = 'attention'
const TOOL = 'attention'
const TOOL_FULL = 'mcp__attention__attention'
const REFRESH_MS = 30_000
const STORE_KEY = 'items'

// The shared list: `$.store` holds it across sessions, `$.state` mirrors it so drawings redraw.
const itemsAtom = atom({ plugin: 'attention', key: 'items' } as const, [] as Item[])
const showDoneAtom = atom({ plugin: 'attention', key: 'showDone' } as const, false)
// What is typed in each reply field, by item id, so the Send button can send it.
const draftsAtom = atom({ plugin: 'attention', key: 'drafts' } as const, {} as Record<string, string>)

const GUIDANCE = `# Tracking items that need the user's attention

You have an \`${TOOL_FULL}\` tool that keeps a list of open items the user sees above their prompt.
- When you end a turn with a question or a decision only the user can make, call it with action "add", kind "question", and a one-line summary of what you need from them.
- Set "blocking": true on a question only when you have stopped and cannot continue until the user answers; leave it off when you made a reasonable choice and the user can weigh in whenever.
- When you tell the user to do something later that you cannot do yourself (restart a server, review before merging, rotate a key), call it with action "add", kind "followup".
- When an item you or the user logged is dealt with (the user answered, the follow-up is done), call it with action "resolve" and its ids. Use action "list" to see open ids.
- A message that begins \`Re: "<item>" [<id>]\` (typed here, or sent from another session's attention list) is the user's reply to that logged question or follow-up: act on it, then resolve that id unless the reply leaves it open.
- Always give a "detail" of 1-3 sentences that makes sense to someone who has not seen this conversation: what you were doing, the options, and what each answer leads to.
- Keep each item's text to one short line. Do not log routine progress, and do not log the same thing twice.
Failed commands and the user's own /todo notes are tracked automatically; do not log those.`

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['add', 'resolve', 'list'] },
    kind: { type: 'string', enum: ['question', 'followup'], description: 'For add.' },
    text: { type: 'string', description: 'For add: one short line.' },
    detail: { type: 'string', description: 'For add: optional extra context.' },
    blocking: {
      type: 'boolean',
      description: 'For add with kind "question": true only when you cannot continue until the user answers.',
    },
    ids: { type: 'array', items: { type: 'string' }, description: 'For resolve.' },
  },
  required: ['action'],
}

type ToolArgs = {
  action?: string
  kind?: string
  text?: string
  detail?: string
  blocking?: unknown
  ids?: unknown
}

// Who this session is; set again by session.start after every reload.
let session = 'unknown'
let folder = 'unknown'
let sessionId = 'unknown'
// The desktop app's link to this session; absent in a terminal or remote session.
let link: string | undefined
// Whether Claude logged an item itself during the current main-loop turn.
let hasLoggedThisTurn = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    sessionId = await $.session.id()
    session = sessionId.slice(0, 8)
    const hostId = await $.env.get('CLAUDE_CODE_HOST_SESSION_ID')
    link = hostId ? `claude://claude.ai/epitaxy/${hostId}` : undefined
    folder = e.cwd.split('/').filter(Boolean).pop() ?? e.cwd

    await $.tool.register({
      name: TOOL,
      description:
        "Track items that need the user's attention: questions you asked them and follow-ups only they can do. Actions: add, resolve, list.",
      inputSchema: TOOL_SCHEMA,
    })
    await $.command.register({ name: 'todo', description: 'Add a note to your attention list' })
    await $.command.register({
      name: 'attention',
      description: "Open the attention list ('clear' marks this session's items done)",
    })
    await refresh($)
    $.clock.every(REFRESH_MS, () => void refresh($))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    hasLoggedThisTurn = false
    await refresh($)

    return next(e)
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return {
      ...composed,
      sections: [...composed.sections, { id: 'attention', text: GUIDANCE, scope: 'session' }],
    }
  })

  // Backstop: a reply that ends on a question Claude did not log gets logged anyway.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    const question =
      e.agentId === undefined && e.reason === 'answer' && !hasLoggedThisTurn ? trailingQuestion(e.answer) : undefined

    if (question !== undefined) {
      const isKnown = openItems(await read($, itemsAtom)).some(
        one => one.session === session && one.kind === 'question' && one.text === question,
      )

      if (!isKnown) {
        const item = await newItem($, 'question', question)
        await change($, items => add(items, item))
        $.ui.toast(`Question for you: ${question}`)
      }
    }

    return done
  })

  // The model's own tool.
  on('tool.call', { tool: TOOL_FULL }, async ($, e) => {
    const args = e as unknown as ToolArgs

    if (args.action === 'list') {
      return { result: listing(await read($, itemsAtom)) }
    }

    if (args.action === 'resolve') {
      const ids = Array.isArray(args.ids) ? args.ids.filter((id): id is string => typeof id === 'string') : []

      if (ids.length === 0) {
        return { isError: true, result: 'resolve needs ids; call with action "list" to see them.' }
      }

      const now = await $.clock.now()
      await change($, items => resolve(items, ids, now))

      return { result: `Resolved ${ids.length} item(s).` }
    }

    if (args.action === 'add') {
      const text = args.text?.trim()

      if (!text || (args.kind !== 'question' && args.kind !== 'followup')) {
        return { isError: true, result: 'add needs kind ("question" or "followup") and text.' }
      }

      const detail = args.detail?.trim()
      const isBlocking = args.kind === 'question' && args.blocking === true
      const item = await newItem($, args.kind, text, {
        ...(detail ? { detail } : {}),
        ...(isBlocking ? { blocking: true } : {}),
      })
      await change($, items => add(items, item))
      hasLoggedThisTurn = true

      if (item.kind === 'question') {
        $.ui.toast(`Question for you: ${text}`)
      }

      return { result: `Logged ${isBlocking ? 'blocking ' : ''}${item.kind} [${item.id}].` }
    }

    return { isError: true, result: 'action must be add, resolve or list.' }
  })

  // Failures and denials of every other tool.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)

    if (e.tool === TOOL_FULL) {
      return ran
    }

    const what = describeCall(e.tool, e as unknown as Record<string, unknown>)
    const fingerprint = `${e.tool}:${what}`

    if (ran.isError === true && e.tool === 'Bash' && isNoise(e.command, ran.text) && !hasStderr(ran.result)) {
      return ran
    }

    if (ran.deny !== undefined || ran.isError === true) {
      const isDenied = ran.deny !== undefined
      const text = `${isDenied ? 'Denied' : 'Failed'}: ${what}`
      const detail = (isDenied ? ran.deny : ran.text)?.trim().slice(0, 400)
      const item = await newItem($, 'failure', text, {
        fingerprint,
        ...(detail ? { detail } : {}),
      })
      const before = openItems(await read($, itemsAtom)).length
      const after = openItems(await change($, items => addFailure(items, item))).length

      if (after > before) {
        $.ui.toast(text)
      }
    } else {
      const shown = await read($, itemsAtom)
      const hasOpen = shown.some(
        one => one.status === 'open' && one.session === session && one.fingerprint === fingerprint,
      )

      if (hasOpen) {
        const now = await $.clock.now()
        await change($, items => resolveFingerprint(items, session, fingerprint, now))
      }
    }

    return ran
  })

  on('command.run', { command: 'todo' }, async ($, e) => {
    const text = e.args.trim()

    if (text === '') {
      return { text: 'Usage: /todo <text>' }
    }

    const item = await newItem($, 'note', text)
    await change($, items => add(items, item))

    return { text: `Added to your attention list: ${text}` }
  })

  on('command.run', { command: 'attention' }, async ($, e) => {
    if (e.args.trim() === 'clear') {
      const now = await $.clock.now()
      const mine = openItems(await read($, itemsAtom))
        .filter(one => one.session === session)
        .map(one => one.id)
      await change($, items => resolve(items, mine, now))

      return { text: `Marked ${mine.length} item(s) from this session done.` }
    }

    await refresh($)
    await openPane($)

    return { text: listing(await read($, itemsAtom)) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const open = openItems(await read($, itemsAtom))

    if (e.props.hasSurvey || open.length === 0) {
      return next(e)
    }

    const { Box, Button } = $.ui.resolve(e)
    const blocking = blockingCount(open)
    const open$ = () => void openPane($)
    // Every part of the bar opens the list; hovering any part underlines the whole bar.
    const hover = { scope: 'attention-bar', underline: true }

    return (
      <Box>
        {blocking > 0 && (
          <Button key="open-blocking" label={`⚑ ${blocking} blocking`} variant="primary" hover={hover} onPress={open$} />
        )}
        <Button
          key="open"
          plain
          label={`${blocking > 0 ? ' ' : '⚑ '}${open.length} need${open.length === 1 ? 's' : ''} you`}
          hover={hover}
          onPress={open$}
        />
        <Button key="open-summary" plain dimColor label={` · ${summary(open)}`} hover={hover} onPress={open$} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Input, Text } = $.ui.resolve(e)
    const items = await read($, itemsAtom)
    const showDone = await read($, showDoneAtom)
    // The phone draws no text fields, so there Answer fills the prompt box instead.
    const hasReplyField = e.surface !== 'mobile'
    const shown = showDone ? items : openItems(items)

    const reopen = (id: string) => () =>
      void change($, list => list.map(one => (one.id === id ? { ...one, repliedAt: undefined } : one)))

    const done = (id: string) => async () => {
      const now = await $.clock.now()
      await change($, list => resolve(list, [id], now))
    }

    return (
      <Box flexDirection="column">
        <Box>
          <Text bold>{openItems(items).length === 0 ? 'Nothing needs you.' : summary(items)} </Text>
          <Button
            key="toggle-done"
            label={showDone ? 'Hide done' : 'Show done'}
            onPress={() => update($, showDoneAtom, value => !value)}
          />
        </Box>
        {KIND_ORDER.map(kind => {
          const group = ofKind(shown, kind)

          return group.length === 0 ? null : (
            <Box key={`group-${kind}`} flexDirection="column" marginTop={1}>
              <Text bold color="suggestion">
                {KIND_LABEL[kind][1].toUpperCase()}
              </Text>
              {group.map(one => {
                const isOpen = one.status === 'open'
                // Questions and follow-ups need a response, so they get a reply field, never a dismiss;
                // Claude closes them once it has acted on the reply.
                const isAnswerable = one.kind === 'question' || one.kind === 'followup'
                const isElsewhere = one.session !== session
                // Logged before items saved their session's id: a reply here could not reach it.
                const isUnreachable = isAnswerable && isElsewhere && one.sessionId === undefined
                const hasReplied = one.repliedAt !== undefined
                const canReply = isOpen && isAnswerable && !isUnreachable && !hasReplied

                return (
                  <Box key={`item-${one.id}`} flexDirection="column">
                    <Box>
                      {!isOpen && <Text dimColor>✓ </Text>}
                      {isOpen && (!isAnswerable || isUnreachable) && (
                        <Button key={`done-${one.id}`} label="✓" onPress={done(one.id)} />
                      )}
                      <Text
                        dimColor={!isOpen}
                        strikethrough={!isOpen}
                        color={one.blocking && isOpen ? 'error' : undefined}
                      >
                        {canReply ? '' : ' '}
                        {one.text}
                      </Text>
                      {isElsewhere && <Text dimColor> ({one.folder})</Text>}
                      {isOpen && isElsewhere && one.link && (
                        <Button key={`go-${one.id}`} label="Go" onPress={() => void goTo($, one)} />
                      )}
                      {canReply && !hasReplyField && (
                        <Button key={`answer-${one.id}`} label="Answer" onPress={() => void answer($, one)} />
                      )}
                    </Box>
                    {one.detail && isOpen && (
                      <Text dimColor wrap="wrap">
                        {'  '}
                        {one.detail}
                      </Text>
                    )}
                    {isOpen && isUnreachable && (
                      <Text dimColor>{'  '}Logged before replies could reach other sessions: reply in that session, or ✓ to clear.</Text>
                    )}
                    {isOpen && hasReplied && (
                      <Box>
                        <Text dimColor>{'  '}Reply sent, waiting for Claude. </Text>
                        <Button key={`again-${one.id}`} label="Reply again" plain dimColor onPress={reopen(one.id)} />
                      </Box>
                    )}
                    {canReply && hasReplyField && (
                      <Box>
                        <Input
                          key={`reply-${one.id}`}
                          placeholder={isElsewhere ? `Reply to ${one.folder}…` : 'Reply…'}
                          submitLabel="send"
                          onInput={value => void update($, draftsAtom, drafts => ({ ...drafts, [one.id]: value }))}
                          onSubmit={value => void sendReply($, one, value)}
                        />
                        <Button
                          key={`send-${one.id}`}
                          label="Send"
                          variant="primary"
                          onPress={async () => sendReply($, one, (await read($, draftsAtom))[one.id] ?? '')}
                        />
                      </Box>
                    )}
                  </Box>
                )
              })}
            </Box>
          )
        })}
      </Box>
    )
  })
}

async function newItem(
  $: EngineInterface,
  kind: ItemKind,
  text: string,
  extra: Partial<Item> = {},
): Promise<Item> {
  const now = await $.clock.now()

  return {
    id: makeId(now),
    kind,
    text,
    session,
    sessionId,
    ...(link ? { link } : {}),
    folder,
    createdAt: now,
    status: 'open',
    ...extra,
  }
}

/**
 * Sends the reply to the session that logged the item, tagged so Claude there can close it after acting
 * on it: this session through its own prompt, another through a session message.
 */
async function sendReply($: EngineInterface, item: Item, value: string): Promise<void> {
  const reply = value.trim()

  if (reply === '') {
    return
  }

  // Claim the item first, from the stored list, so a second Enter or click sends nothing more.
  let isClaimed = false
  const now = await $.clock.now()
  await change($, items =>
    items.map(one => {
      if (one.id !== item.id || one.status !== 'open' || one.repliedAt !== undefined) {
        return one
      }

      isClaimed = true

      return { ...one, repliedAt: now }
    }),
  )

  if (!isClaimed) {
    return
  }

  await update($, draftsAtom, ({ [item.id]: _sent, ...rest }) => rest)
  const text = `Re: "${item.text}" [${item.id}]\n${reply}`

  if (item.session === session) {
    await $.prompt.submit({ text })

    return
  }

  const sent =
    item.sessionId === undefined
      ? { isDelivered: false as const, reason: 'it was logged before replies could reach other sessions' }
      : await $.session.send({ to: { sessionId: item.sessionId }, text })

  if (!sent.isDelivered) {
    // Give the field back so the user can try again or go there instead.
    await change($, items => items.map(one => (one.id === item.id ? { ...one, repliedAt: undefined } : one)))
  }

  $.ui.toast(
    sent.isDelivered
      ? `Reply sent to ${item.folder}.`
      : `Couldn't reach the ${item.folder} session (${sent.reason})${item.link ? '; use Go to open it.' : '.'}`,
  )
}

/** Switches the app to the session that logged the item. */
async function goTo($: EngineInterface, item: Item): Promise<void> {
  if (item.link !== undefined) {
    await $.process.run(['open', item.link])
  }
}

/** Quotes a question or follow-up into the prompt box, tagged with its id so the reply can resolve it. */
async function answer($: EngineInterface, item: Item): Promise<void> {
  // Close first: while the pane holds the keys, the prompt box refuses text.
  await $.ui.close({ id: PANE })
  await $.prompt.fill({ text: `Re: "${item.text}" [${item.id}]\n`, mode: 'replace' })
}

async function openPane($: EngineInterface): Promise<void> {
  // Opened by the person (the bar or /attention), so it takes the keys: a first click then lands.
  await $.ui.open({ id: PANE, title: 'Needs attention', focus: true })
}

function hasStderr(result: unknown): boolean {
  const stderr = typeof result === 'object' && result !== null ? (result as { stderr?: unknown }).stderr : undefined

  return typeof stderr === 'string' && stderr.trim() !== ''
}

function describeCall(tool: string, input: Record<string, unknown>): string {
  const subject = [input.command, input.file_path, input.path, input.pattern, input.url, input.description].find(
    value => typeof value === 'string' && value.trim() !== '',
  ) as string | undefined

  const oneLine = subject?.replace(/\s+/g, ' ').trim()

  return oneLine ? `${tool}(${oneLine.length > 80 ? `${oneLine.slice(0, 77)}...` : oneLine})` : tool
}

async function load($: EngineInterface): Promise<Item[]> {
  const stored = await $.store.get(STORE_KEY)

  return isItemList(stored) ? stored : []
}

/**
 * Reads the stored list fresh, applies `fn` and writes it back, so a change made by
 * another session since our last read is kept rather than overwritten.
 */
async function change($: EngineInterface, fn: (items: readonly Item[]) => Item[]): Promise<Item[]> {
  const next = fn(await load($))
  await $.store.set(STORE_KEY, next)
  await update($, itemsAtom, () => next)

  return next
}

/** Pulls other sessions' changes into the mirror; writes only when something differs. */
async function refresh($: EngineInterface): Promise<void> {
  const stored = await load($)
  const shown = await read($, itemsAtom)

  if (JSON.stringify(stored) !== JSON.stringify(shown)) {
    await update($, itemsAtom, () => stored)
  }
}
