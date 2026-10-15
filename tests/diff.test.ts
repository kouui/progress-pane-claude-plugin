import { test, expect } from 'claude-code/testing'

import { baseName, groupByDir, mergeFiles, parseNumstat, parseUntracked, totals } from '../hooks/diff'

test('parseNumstat reads counts and marks binary files', async () => {
  const out = parseNumstat('12\t3\tsrc/a.ts\n-\t-\timg/b.png\n0\t5\tc.md\nnot a line\n')
  expect(out).toEqual([
    { path: 'src/a.ts', added: 12, removed: 3, kind: 'M' },
    { path: 'img/b.png', added: 0, removed: 0, kind: 'B' },
    { path: 'c.md', added: 0, removed: 5, kind: 'M' },
  ])
})

test('parseUntracked lists new files', async () => {
  expect(parseUntracked('a.txt\r\n\nsub/b.txt\n')).toEqual([
    { path: 'a.txt', added: 0, removed: 0, kind: 'N' },
    { path: 'sub/b.txt', added: 0, removed: 0, kind: 'N' },
  ])
})

test('mergeFiles puts tracked first and shows a path once', async () => {
  const merged = mergeFiles(
    [{ path: 'b', added: 1, removed: 0, kind: 'M' }, { path: 'a', added: 2, removed: 0, kind: 'M' }],
    [{ path: 'z', added: 0, removed: 0, kind: 'N' }, { path: 'a', added: 0, removed: 0, kind: 'N' }],
  )
  expect(merged.map(f => `${f.kind}:${f.path}`)).toEqual(['M:a', 'M:b', 'N:z'])
  expect(totals(merged)).toEqual({ files: 3, added: 3, removed: 0 })
})

test('baseName keeps the last segment', async () => {
  expect(baseName('hooks/register.tsx')).toBe('register.tsx')
  expect(baseName('README.md')).toBe('README.md')
})

test('groupByDir groups by full directory path and sums each group', async () => {
  const groups = groupByDir([
    { path: 'src/ui/b.ts', added: 2, removed: 1, kind: 'M' },
    { path: 'README.md', added: 1, removed: 0, kind: 'M' },
    { path: 'src/ui/a.ts', added: 3, removed: 0, kind: 'M' },
    { path: 'src/new.ts', added: 0, removed: 0, kind: 'N' },
  ])
  expect(groups.map(g => g.dir)).toEqual(['./', 'src/', 'src/ui/'])
  const ui = groups[2]
  expect(ui.files.map(f => f.path)).toEqual(['src/ui/a.ts', 'src/ui/b.ts'])
  expect([ui.added, ui.removed]).toEqual([5, 1])
  expect([ui.trackedCount, ui.newCount]).toEqual([2, 0])
  expect([groups[1].trackedCount, groups[1].newCount]).toEqual([0, 1]) // src/ holds only the new file
})
