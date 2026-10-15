// Pure helpers of the Changes list: git output in, rows out. No engine access: unit-tested directly.
import type { DiffFile } from '../types'

/** `git diff --numstat` lines: `<added>\t<removed>\t<path>`; `-` counts mean a binary file. */
export function parseNumstat(text: string): DiffFile[] {
  const out: DiffFile[] = []
  for (const line of text.split('\n')) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line.replace(/\r$/, ''))
    if (!m) continue
    const isBinary = m[1] === '-' || m[2] === '-'
    out.push({ path: m[3], added: isBinary ? 0 : Number(m[1]), removed: isBinary ? 0 : Number(m[2]), kind: isBinary ? 'B' : 'M' })
  }
  return out
}

/** `git ls-files --others` lines: one untracked path each. */
export function parseUntracked(text: string): DiffFile[] {
  return text
    .split('\n')
    .map(l => l.replace(/\r$/, ''))
    .filter(l => l !== '')
    .map(path => ({ path, added: 0, removed: 0, kind: 'N' as const }))
}

/** Tracked changes first by path, then new files by path; a path in both lists is shown once, as tracked. */
export function mergeFiles(tracked: DiffFile[], untracked: DiffFile[]): DiffFile[] {
  const seen = new Set(tracked.map(f => f.path))
  const byPath = (a: DiffFile, b: DiffFile) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)

  return [...[...tracked].sort(byPath), ...untracked.filter(f => !seen.has(f.path)).sort(byPath)]
}

export function totals(files: readonly DiffFile[]): { files: number; added: number; removed: number } {
  return {
    files: files.length,
    added: files.reduce((n, f) => n + f.added, 0),
    removed: files.reduce((n, f) => n + f.removed, 0),
  }
}

/** The last path segment, for a narrow pane. */
export function baseName(path: string): string {
  const i = path.lastIndexOf('/')

  return i < 0 ? path : path.slice(i + 1)
}

/** The directory a path is in, `./` for the repository root. */
export function dirOf(path: string): string {
  const i = path.lastIndexOf('/')

  return i < 0 ? './' : `${path.slice(0, i)}/`
}

export type DirGroup = { dir: string; files: DiffFile[]; added: number; removed: number }

/** The files grouped by full directory path, groups by directory, files by name. */
export function groupByDir(files: readonly DiffFile[]): DirGroup[] {
  const groups = new Map<string, DirGroup>()
  for (const f of files) {
    const dir = dirOf(f.path)
    const g = groups.get(dir) ?? { dir, files: [], added: 0, removed: 0 }
    g.files.push(f)
    g.added += f.added
    g.removed += f.removed
    groups.set(dir, g)
  }
  const byName = (a: DiffFile, b: DiffFile) => (baseName(a.path) < baseName(b.path) ? -1 : baseName(a.path) > baseName(b.path) ? 1 : 0)

  return [...groups.values()]
    .map(g => ({ ...g, files: [...g.files].sort(byName) }))
    .sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0))
}
