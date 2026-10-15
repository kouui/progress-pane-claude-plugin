import { test, expect } from 'claude-code/testing'

import { clean, countDone, fromTodos, hasOpenSteps, touch } from '../hooks/steps'

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
