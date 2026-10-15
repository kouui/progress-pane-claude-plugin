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

/** Sessions whose progress is kept. */
export const KEEP_SESSIONS = 20

/** True while some step is not done. */
export function hasOpenSteps(list: readonly Step[]): boolean {
  return list.some(s => s.status !== 'done')
}

/**
 * The session index after `id` was saved: `id` moved to the end (most recent last), and the oldest
 * dropped beyond `keep`. `drop` lists the ids whose records are to be deleted.
 */
export function touch(index: readonly string[], id: string, keep: number = KEEP_SESSIONS): { index: string[]; drop: string[] } {
  const next = [...index.filter(x => x !== id), id]
  const cut = Math.max(0, next.length - keep)

  return { index: next.slice(cut), drop: next.slice(0, cut) }
}
