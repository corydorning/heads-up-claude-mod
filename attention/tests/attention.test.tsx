import { expect, mock, test } from 'claude-code/testing'

const TOOL = 'mcp__attention__attention'

// Stands in for the engine beneath the plugin, then starts the session.
let filled: string | undefined
let submitted: string | undefined
// Like the app: while the pane holds the keys, the prompt box refuses text.
let isPaneOpen = true

async function start($: any, on: any) {
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

test('questions and follow-ups cannot be dismissed, only answered; notes can be checked off', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Use tabs?' })
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'followup', text: 'Rotate the key' })
  await $.command.run({ command: 'todo', args: 'buy milk', origin: { kind: 'user' }, presentation: {} })

  const pane = await $.ui.mount({
    plugin: 'attention',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'attention',
    props: { title: 'Needs attention', isFocused: true, bodyColumns: 60 },
  })
  const keys = (await pane.findAll({ type: 'Button' })).map(one => one.key ?? '')
  expect(keys.filter(key => key.startsWith('done-'))).toHaveLength(1)
  expect(keys.filter(key => key.startsWith('answer-'))).toHaveLength(2)
  await pane.unmount()
})

const PANE_AT = (surface: 'terminal' | 'desktop' | 'mobile') =>
  ({
    plugin: 'attention',
    surface,
    component: 'Pane',
    requestId: 'attention',
    props: { title: 'Needs attention', isFocused: true, bodyColumns: 60 },
  }) as const

test('Answer opens a reply field; Enter sends the reply to Claude, tagged with the item', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'followup', text: 'Restart the dev server' })
  const id = (await listText($)).match(/\[(\w+)\] Restart/)?.[1]

  const pane = await $.ui.mount(PANE_AT('desktop'))
  expect(await pane.find({ key: `reply-${id}` })).toBeUndefined()
  await pane.press({ key: `answer-${id}` })
  expect(await pane.find({ key: `reply-${id}` })).toBeDefined()

  await pane.input({ key: `reply-${id}`, text: 'done, it is back up' })
  expect(submitted).toBe(`Re: "Restart the dev server" [${id}]\ndone, it is back up`)
  expect(await pane.find({ key: `reply-${id}` })).toBeUndefined()
  await pane.unmount()
})

test('an empty reply sends nothing', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Tabs or spaces?' })
  const id = (await listText($)).match(/\[(\w+)\] Tabs/)?.[1]
  const pane = await $.ui.mount(PANE_AT('desktop'))
  await pane.press({ key: `answer-${id}` })
  await pane.input({ key: `reply-${id}`, text: '   ' })
  expect(submitted).toBeUndefined()
  await pane.unmount()
})

test('on the phone, Answer still puts the item in the prompt box on the first tap', async ($: any, on) => {
  mock.store(on)
  mock.clock(on)
  await start($, on)
  await $.tool.call({ tool: TOOL, action: 'add', kind: 'question', text: 'Merge now?' })
  const id = (await listText($)).match(/\[(\w+)\] Merge/)?.[1]
  const pane = await $.ui.mount(PANE_AT('mobile'))
  await pane.press({ key: `answer-${id}` })
  expect(filled).toContain('Merge now?')
  await pane.unmount()
})
