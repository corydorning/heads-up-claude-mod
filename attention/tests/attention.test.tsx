import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__attention__attention'

// Stands in for the engine beneath the plugin, then starts the session.
let filled: string | undefined
let submitted: string | undefined
// Like the app: while the pane holds the keys, the prompt box refuses text.
let isPaneOpen = true

async function start($: any, on: any, env: Record<string, string> = {}) {
  mock.env(on, env)
  filled = undefined
  isPaneOpen = true
  on('prompt.fill', (_$: unknown, e: { text: string }) => {
    if (isPaneOpen) {
      return { isFilled: false, refusal: 'dialog' }
    }
    filled = e.text
    return { isFilled: true }
  })
  submitted = undefined
  on('prompt.submit', (_$: unknown, e: { text: string }) => {
    submitted = e.text
    return { text: e.text }
  })
  on('ui.focus', () => ({ value: {} }))
  on('ui.close', () => {
    isPaneOpen = false
    return { value: undefined }
  })
  on('session.start', (_$: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 'abcdef1234567890' }))
  on('tool.register', (_$: unknown, e: { name: string }) => ({ value: { tool: `mcp__attention__${e.name}` } }))
  on('command.register', (_$: unknown, e: { name: string }) => ({ value: { command: e.name } }))
  // The engine's own band, drawn when the plugin steps aside.
  on('ui.render', { component: 'AbovePrompt' }, ($$: any, e: any) => {
    const { Box } = $$.ui.resolve(e)
    return <Box key="engine-band" />
  })
  await $.session.start({ cwd: '/tmp/my-app', surface: 'terminal', isInteractive: true })
}

async function listText($: any): Promise<string> {
  const listed = await $.tool.call({ tool: TOOL, action: 'list' })
  return String(listed.result)
}

test('a failing Bash command becomes one failure item, and success clears it', async ($: any, on) => {
  mock.store(on)
  mock.clock(on, { now: 1_000 })
  let fails = true
  on('tool.call', { tool: 'Bash' }, () =>
    fails ? { isError: true, result: { stdout: '', stderr: 'boom' }, text: 'boom' } : { result: { stdout: 'ok', stderr: '' } },
  )
  await start($, on)

  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  const text = await listText($)
  expect(text).toContain('Failed: Bash(npm test)')
  expect(text.split('Failed:').length - 1).toBe(1)

  fails = false
  await $.tool.call({ tool: 'Bash', command: 'npm test' })
  expect(await listText($)).toBe('Nothing needs attention.')
})

test('a denied tool call is tracked', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  on('tool.call', { tool: 'Bash' }, () => ({ deny: 'user said no' }))
  await start($, on)

  await $.tool.call({ tool: 'Bash', command: 'rm -rf build' })
  expect(await listText($)).toContain('Denied: Bash(rm -rf build)')
})

test('the model adds and resolves questions through its tool', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  await start($, on)

  const added = await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Use Postgres or SQLite?' })
  const id = /\[(\w+)\]/.exec(String(added.result))?.[1]
  expect(id).toBeDefined()
  expect(await listText($)).toContain('Use Postgres or SQLite?')

  await $.tool.call({ tool: TOOL, action: 'resolve', ids: [id] })
  expect(await listText($)).toBe('Nothing needs attention.')

  const bad = await $.tool.call({ tool: TOOL, action: 'add', kind: 'question' })
  expect(bad.isError).toBe(true)
})

test('/todo adds a note and /attention clear closes this session\'s items', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  await start($, on)

  await $.command.run({ command: 'todo', args: 'rotate the API key', origin: { kind: 'user' }, presentation: {} })
  expect(await listText($)).toContain('rotate the API key')

  const cleared = await $.command.run({ command: 'attention', args: 'clear', origin: { kind: 'user' }, presentation: {} })
  expect(cleared.text).toContain('Marked 1')
  expect(await listText($)).toBe('Nothing needs attention.')
})

test('the band shows a count when items are open and steps aside when none are', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  await start($, on)
  const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 } } as const

  for (const surface of ['terminal', 'desktop'] as const) {
    const empty = await $.ui.mount({ plugin: 'attention', surface, ...BAND })
    expect(await empty.find({ key: 'open' })).toBeUndefined()
    expect(await empty.find({ key: 'engine-band' })).toBeDefined()
    await empty.unmount()
  }

  await $.command.run({ command: 'todo', args: 'check the deploy', origin: { kind: 'user' }, presentation: {} })

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'attention', surface, ...BAND })
    expect((await band.find({ key: 'open' }))?.text).toContain('1 needs you')
    expect((await band.find({ key: 'open-summary' }))?.text).toContain('1 note')
    expect(await band.find({ key: 'open-blocking' })).toBeUndefined()
    await band.unmount()
  }
})

test('the pane lists items and its ✓ button marks one done', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  await start($, on)
  await $.command.run({ command: 'todo', args: 'update the changelog', origin: { kind: 'user' }, presentation: {} })
  const PANE = {
    component: 'Pane',
    requestId: 'attention',
    props: { title: 'Needs attention', isFocused: true, bodyColumns: 60 },
  } as const

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({ plugin: 'attention', surface, ...PANE })
    expect(await pane.find({ type: 'Text', text: /update the changelog/ })).toBeDefined()
    await pane.unmount()
  }

  const pane = await $.ui.mount({ plugin: 'attention', surface: 'terminal', ...PANE })
  const done = (await pane.findAll({ type: 'Button' })).find(one => one.key?.startsWith('done-'))
  expect(done).toBeDefined()
  await pane.press({ key: done!.key! })
  expect(await listText($)).toBe('Nothing needs attention.')
  expect(await pane.find({ type: 'Text', text: /Nothing needs you/ })).toBeDefined()
  await pane.unmount()
})

test('noise is skipped but a real failure in the same shape is kept', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  on('tool.call', { tool: 'Bash' }, (_$: unknown, e: { command: string }) =>
    e.command.startsWith('grep')
      ? { isError: true, result: { stdout: '', stderr: '' }, text: 'Exit code 1' }
      : { isError: true, result: { stdout: '', stderr: 'boom' }, text: 'Exit code 1\nboom' },
  )
  await start($, on)

  await $.tool.call({ tool: 'Bash', command: 'grep -rn TODO src' })
  expect(await listText($)).toBe('Nothing needs attention.')

  await $.tool.call({ tool: 'Bash', command: 'npm run build' })
  expect(await listText($)).toContain('Failed: Bash(npm run build)')
})

test('a turn that ends on an unlogged question logs it; a logged one is not doubled', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  on('turn.complete', (_$: unknown, e: { answer: string }) => ({ text: e.answer }))
  await start($, on)
  const end = (answer: string, turnId: string) =>
    $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId, reason: 'answer' })

  await $.turn.start({ text: 'what next', turnId: 't1' })
  await end('Two options.\n\nWant me to build snooze?', 't1')
  expect(await listText($)).toContain('Want me to build snooze?')

  await $.turn.start({ text: 'ok', turnId: 't2' })
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Snooze for 1h or 1d?' })
  await end('Snooze for one hour or one day?', 't2')
  const text = await listText($)
  expect(text).toContain('Snooze for 1h or 1d?')
  expect(text).not.toContain('Snooze for one hour or one day?')
})

test('a blocking question shows as blocking in the band', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Delete the old database?', blocking: true })
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Blue button OK?' })
  expect(await listText($)).toContain('(blocking)')

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'attention',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 },
    })
    expect((await band.find({ key: 'open-blocking' }))?.text).toContain('1 blocking')
    await band.unmount()
  }
})

test('clicking anywhere on the bar opens the list', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  const opened: string[] = []
  on('ui.open', (_$: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Stuck here?', blocking: true })

  const band = await $.ui.mount({
    plugin: 'attention',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 100 },
  })
  for (const key of ['open-blocking', 'open', 'open-summary']) {
    await band.press({ key })
  }
  expect(opened).toEqual(['attention', 'attention', 'attention'])
  await band.unmount()
})

const PANE_AT = (surface: 'terminal' | 'desktop' | 'mobile') =>
  ({
    plugin: 'attention',
    surface,
    component: 'Pane',
    requestId: 'attention',
    props: { title: 'Needs attention', isFocused: true, bodyColumns: 60 },
  }) as const

// An item another session logged, with that session's id and app link.
const FROM_ELSEWHERE = {
  id: 'other1',
  kind: 'question',
  text: 'Deploy to staging?',
  detail: 'The build passed; staging is idle.',
  session: 'otherses',
  sessionId: 'otherses-full-id',
  link: 'claude://claude.ai/epitaxy/local_other',
  folder: 'shop-api',
  createdAt: 1,
  status: 'open',
}

let sentTo: { to: unknown; text: string } | undefined
let ran: readonly string[] | undefined

function stubElsewhere(on: any) {
  sentTo = undefined
  ran = undefined
  on('session.send', (_$: unknown, e: { to: unknown; text: string }) => {
    sentTo = e
    return { isDelivered: true }
  })
  on('process.run', (_$: unknown, e: { argv: readonly string[] }) => {
    ran = e.argv
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
}

test('questions and follow-ups have a reply field and no dismiss; notes keep their check', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  stubElsewhere(on)
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Use tabs?' })
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'followup', text: 'Rotate the key' })
  await $.command.run({ command: 'todo', args: 'buy milk', origin: { kind: 'user' }, presentation: {} })

  const pane = await $.ui.mount(PANE_AT('terminal'))
  const keys = (await pane.findAll({})).map(one => one.key ?? '')
  expect(keys.filter(key => key.startsWith('reply-'))).toHaveLength(2)
  expect(keys.filter(key => key.startsWith('done-'))).toHaveLength(1)
  expect(keys.filter(key => key.startsWith('answer-'))).toHaveLength(0)
  // Items from this session need no Go button.
  expect(keys.filter(key => key.startsWith('go-'))).toHaveLength(0)
  await pane.unmount()
})

test('a reply to this session\'s item comes to this session, tagged with the item', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  stubElsewhere(on)
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'followup', text: 'Restart the dev server' })
  const id = (await listText($)).match(/\[(\w+)\] Restart/)?.[1]

  const pane = await $.ui.mount(PANE_AT('desktop'))
  await pane.input({ key: `reply-${id}`, text: 'done, it is back up' })
  expect(submitted).toBe(`Re: "Restart the dev server" [${id}]\ndone, it is back up`)
  expect(sentTo).toBeUndefined()
  await pane.unmount()
})

test('a reply to another session\'s item is sent to that session', async ($: any, on) => {
  mock.store(on, { items: [FROM_ELSEWHERE] })
  mock.clock(on)
  stubElsewhere(on)
  await start($, on)

  const pane = await $.ui.mount(PANE_AT('desktop'))
  await pane.input({ key: 'reply-other1', text: 'yes, go ahead' })
  // The engine resolves `{ sessionId }` to that session's address on the way through.
  expect(sentTo).toMatchObject({ to: 'otherses-full-id', text: 'Re: "Deploy to staging?" [other1]\nyes, go ahead' })
  expect(submitted).toBeUndefined()
  await pane.unmount()
})

test('Go opens the session the item came from', async ($: any, on) => {
  mock.store(on, { items: [FROM_ELSEWHERE] })
  mock.clock(on)
  stubElsewhere(on)
  await start($, on)

  const pane = await $.ui.mount(PANE_AT('desktop'))
  await pane.press({ key: 'go-other1' })
  expect(ran).toEqual(['open', 'claude://claude.ai/epitaxy/local_other'])
  expect(await pane.find({ type: 'Text', text: /staging is idle/ })).toBeDefined()
  await pane.unmount()
})

test('items record this session\'s app link when it has one', async ($: any, on) => {
  // Captures what the mod stores, in place of mock.store.
  let stored: { link?: string; sessionId?: string }[] = []
  on('store.get', () => ({ value: stored }))
  on('store.set', (_$: unknown, e: { value: typeof stored }) => {
    stored = e.value
    return { value: undefined }
  })
  mock.clock(on)
  stubElsewhere(on)
  await start($, on, { CLAUDE_CODE_HOST_SESSION_ID: 'local_here' })
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Ship it?' })
  expect(stored[0]).toMatchObject({ link: 'claude://claude.ai/epitaxy/local_here', sessionId: 'abcdef1234567890' })
})

test('an empty reply sends nothing', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  stubElsewhere(on)
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Tabs or spaces?' })
  const id = (await listText($)).match(/\[(\w+)\] Tabs/)?.[1]
  const pane = await $.ui.mount(PANE_AT('desktop'))
  await pane.input({ key: `reply-${id}`, text: '   ' })
  expect(submitted).toBeUndefined()
  await pane.unmount()
})

test('on the phone, which has no text fields, Answer puts the item in the prompt box', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  stubElsewhere(on)
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Merge now?' })
  const id = (await listText($)).match(/\[(\w+)\] Merge/)?.[1]
  const pane = await $.ui.mount(PANE_AT('mobile'))
  await pane.press({ key: `answer-${id}` })
  expect(filled).toContain('Merge now?')
  await pane.unmount()
})

test('an older item from another session, saved before session ids, offers ✓ instead of a reply field', async ($: any, on) => {
  const { sessionId: _id, link: _link, ...older } = FROM_ELSEWHERE
  mock.store(on, { items: [older] })
  mock.clock(on)
  stubElsewhere(on)
  await start($, on)

  const pane = await $.ui.mount(PANE_AT('desktop'))
  expect(await pane.find({ key: 'reply-other1' })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /reply in that session/ })).toBeDefined()
  await pane.press({ key: 'done-other1' })
  expect(await listText($)).toBe('Nothing needs attention.')
  await pane.unmount()
})

test('a reply is sent once: the field gives way to a sent note and repeats are ignored', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  stubElsewhere(on)
  let submits = 0
  on('turn.start', (_$: unknown, e: { turnId: string }) => ({ turnId: e.turnId }))
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Add the setting?' })
  const id = (await listText($)).match(/\[(\w+)\] Add/)?.[1]

  const pane = await $.ui.mount(PANE_AT('desktop'))
  await pane.input({ key: `reply-${id}`, text: 'ok' })
  if (submitted) submits += 1
  submitted = undefined
  expect(await pane.find({ key: `reply-${id}` })).toBeUndefined()
  expect(await pane.find({ type: 'Text', text: /Reply sent/ })).toBeDefined()
  await pane.unmount()

  // Even a reply that reaches the handler again is dropped.
  const again = await $.ui.mount(PANE_AT('desktop'))
  expect(await again.find({ key: `reply-${id}` })).toBeUndefined()
  expect(submits).toBe(1)
  // Reply again gives the field back, for when Claude leaves the item open.
  await again.press({ key: `again-${id}` })
  expect(await again.find({ key: `reply-${id}` })).toBeDefined()
  await again.unmount()
})

test('the Send button sends what was typed, once', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  stubElsewhere(on)
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Ship today?' })
  const id = (await listText($)).match(/\[(\w+)\] Ship/)?.[1]

  const pane = await $.ui.mount(PANE_AT('desktop'))
  await pane.input({ key: `reply-${id}`, text: 'yes, ship it', kind: 'change' })
  expect(submitted).toBeUndefined()
  await pane.press({ key: `send-${id}` })
  expect(submitted).toBe(`Re: "Ship today?" [${id}]\nyes, ship it`)
  expect(await pane.find({ key: `send-${id}` })).toBeUndefined()
  await pane.unmount()
})
