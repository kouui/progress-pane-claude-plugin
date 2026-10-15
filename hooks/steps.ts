// Pure helpers of the pane: no engine access, unit-tested directly.
import type { Step } from '../types'

export const MARK = { done: '✓', in_progress: '▶', pending: '·' } as const

/** The model's list as steps: bad items dropped, titles trimmed, at most 50. */
export function clean(raw: unknown): Step[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((s): Step => ({
      title: String(s?.title ?? '').trim().slice(0, 120),
      status: s?.status === 'done' || s?.status === 'in_progress' ? s.status : 'pending',
    }))
    .filter(s => s.title !== '')
    .slice(0, 50)
}

/** The built-in TodoWrite's items as steps. */
export function fromTodos(todos: ReadonlyArray<{ content: string; status: string }>): Step[] {
  return clean(todos.map(t => ({ title: t.content, status: t.status === 'completed' ? 'done' : t.status })))
}

export function countDone(list: readonly Step[]): number {
  return list.filter(s => s.status === 'done').length
}
