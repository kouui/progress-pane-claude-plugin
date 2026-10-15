import { test, expect } from 'claude-code/testing'

import { clean, countDone, describeChanges, fromTodos, hasOpenSteps, mergeOverrides, nextStatus, touch } from '../hooks/steps'

test('clean drops bad items and defaults the status', async () => {
  const list = clean([
    { title: ' Read the spec ', status: 'done' },
    { title: '', status: 'done' },
    { title: 'Write code', status: 'weird' },
    null,
  ])
  expect(list).toEqual([
    { title: 'Read the spec', status: 'done' },
    { title: 'Write code', status: 'pending' },
  ])
  expect(clean('nope')).toEqual([])
})

test('fromTodos maps completed to done', async () => {
  const list = fromTodos([
    { content: 'a', status: 'completed' },
    { content: 'b', status: 'in_progress' },
    { content: 'c', status: 'pending' },
  ])
  expect(list.map(s => s.status)).toEqual(['done', 'in_progress', 'pending'])
  expect(countDone(list)).toBe(1)
})

test('the progress tool answers with the count', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const out = (await $.tool.call({
    tool: 'mcp__progress-pane__progress',
    steps: [{ title: 'a', status: 'done' }, { title: 'b', status: 'in_progress' }],
  } as never)) as { result?: string }
  expect(out.result).toBe('Progress saved: 1 of 2 done.')
})

test('touch keeps the newest sessions and names the ones to drop', async () => {
  expect(touch(['a', 'b'], 'c', 3)).toEqual({ index: ['a', 'b', 'c'], drop: [] })
  expect(touch(['a', 'b', 'c'], 'd', 3)).toEqual({ index: ['b', 'c', 'd'], drop: ['a'] })
  expect(touch(['a', 'b', 'c'], 'a', 3)).toEqual({ index: ['b', 'c', 'a'], drop: [] }) // saved again: most recent
})

test('hasOpenSteps is false only when every step is done', async () => {
  expect(hasOpenSteps([{ title: 'a', status: 'done' }])).toBe(false)
  expect(hasOpenSteps([{ title: 'a', status: 'done' }, { title: 'b', status: 'pending' }])).toBe(true)
  expect(hasOpenSteps([])).toBe(false)
})

test('nextStatus cycles pending, in progress, done', async () => {
  expect(nextStatus('pending')).toBe('in_progress')
  expect(nextStatus('in_progress')).toBe('done')
  expect(nextStatus('done')).toBe('pending')
})

test('mergeOverrides keeps the status the person set until the model changes that step', async () => {
  const sent = [{ title: 'a', status: 'in_progress' as const }, { title: 'b', status: 'pending' as const }]
  // the person marked a as done; the model resends the same statuses: the person wins
  const kept = mergeOverrides(sent, { a: 'done' }, { a: 'in_progress', b: 'pending' })
  expect(kept.list.map(s => s.status)).toEqual(['done', 'pending'])
  expect(kept.overrides).toEqual({ a: 'done' })
  // the model now sends a as pending: it changed it on purpose, so the override goes
  const changed = mergeOverrides([{ title: 'a', status: 'pending' }, sent[1]], kept.overrides, kept.view)
  expect(changed.list.map(s => s.status)).toEqual(['pending', 'pending'])
  expect(changed.overrides).toEqual({})
})

test('describeChanges names what the person changed', async () => {
  expect(describeChanges({}, false)).toBe('')
  expect(describeChanges({ a: 'done' }, false)).toBe('The person changed the progress list: "a" -> done.')
  expect(describeChanges({}, true)).toBe('The person changed the progress list: cleared the whole list.')
})
