import { test, expect } from 'claude-code/testing'

import { baseName, mergeFiles, parseNumstat, parseUntracked, totals } from '../hooks/diff'

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
