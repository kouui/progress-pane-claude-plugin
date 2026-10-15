import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { DiffFile, Step } from '../types'

import { baseName, groupByDir, mergeFiles, parseNumstat, parseUntracked, totals } from './diff'
import { MARK, clean, countDone, describeChanges, fromTodos, hasOpenSteps, mergeOverrides, nextStatus, touch } from './steps'
import type { Statuses } from './steps'

const PANE = 'progress'
const TOOL = 'mcp__progress-pane__progress'
const steps = atom({ plugin: 'progress-pane', key: 'steps' } as const, [])
const isFolded = atom({ plugin: 'progress-pane', key: 'isFolded' } as const, true)
const changes = atom({ plugin: 'progress-pane', key: 'diff' } as const, [])
const collapsedDirs = atom({ plugin: 'progress-pane', key: 'collapsedDirs' } as const, [])

const DESCRIPTION =
  'Shows the steps of the current task in a Progress pane the person sees. ' +
  'Send the whole list every time: it replaces the previous one. ' +
  'Call it when a task has 3 or more steps, and again when a step starts or ends. ' +
  'Each title is at most 10 characters (10 Chinese characters or about 20 Latin letters). Exactly one step is in_progress.'

const ADVICE =
  `A task with 3 or more steps: call ${TOOL} with the full step list when you begin, ` +
  'and again each time a step starts or finishes, so the person can see progress at a glance. ' +
  'Skip it for a short single-step answer.'

/** Opens the pane; where no surface draws it, it waits and nothing fails. */
async function openPane($: any): Promise<void> {
  if (view.isLine) return // the one-line band shows the progress; the pane opens only on /progress
  await openAlways($)
}

async function openAlways($: any): Promise<void> {
  try {
    await $.ui.open({ id: PANE, title: 'Progress', columns: view.columns })
  } catch { /* no surface */ }
}

const MARK_COLOR = { done: 'success', in_progress: 'claude', pending: 'subtle' } as const

const view = { isLine: false, columns: 27 }

// the Changes list: uncommitted work against HEAD, read after tools that can change files
const diff = { isEnabled: true, readAt: 0 }
const DIFF_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'Bash', 'PowerShell'])
const DIFF_MIN_GAP_MS = 1500
const DIFF_MAX_ROWS = 12

/** `git diff HEAD --numstat` and the untracked files, or [] where there is no repository. */
async function readChanges($: any): Promise<DiffFile[]> {
  const cwd = await $.session.cwd()
  const git = ['git', '-c', 'core.quotepath=false', '-C', cwd]
  const tracked = await $.process.run([...git, 'diff', 'HEAD', '--numstat', '--no-renames'], { timeoutMs: 2000 })
  const others = await $.process.run([...git, 'ls-files', '--others', '--exclude-standard'], { timeoutMs: 2000 })

  return mergeFiles(
    tracked.exitCode === 0 ? parseNumstat(tracked.stdout) : [],
    others.exitCode === 0 ? parseUntracked(others.stdout) : [],
  )
}

async function refreshChanges($: any, isForced: boolean): Promise<void> {
  if (!diff.isEnabled) return
  try {
    const now = await $.clock.now()
    if (!isForced && now - diff.readAt < DIFF_MIN_GAP_MS) return
    diff.readAt = now
    const files = await readChanges($)
    await update($, changes, () => files)
  } catch { /* the list keeps its last value */ }
}

const INDEX_KEY = 'index'
const keyOf = (id: string) => `steps:${id}`

/** Keeps this session's steps across restarts: one record per session, the newest 20 sessions. */
async function save($: any, list: Step[]): Promise<void> {
  try {
    const id = await $.session.id()
    const old = await $.store.get(INDEX_KEY)
    const { index, drop } = touch(Array.isArray(old) ? old.map(String) : [], id)
    await $.store.set(keyOf(id), list)
    await $.store.set(INDEX_KEY, index)
    for (const gone of drop) await $.store.delete(keyOf(gone))
  } catch { /* not persisted; the pane still works */ }
}

/** The steps this session had before a restart or --resume, or none. */
async function load($: any): Promise<Step[]> {
  try {
    return clean(await $.store.get(keyOf(await $.session.id())))
  } catch {
    return []
  }
}

// the person's edits of the steps: kept over the model's next list, and told to the model once, 1.5 s after the last click
const NOTICE_DEBOUNCE_MS = 1500
const edits = {
  overrides: {} as Statuses, // title -> status the person set
  view: {} as Statuses, // title -> status the model last sent
  pending: {} as Statuses, // changes the model was not told yet
  isCleared: false,
  lastAt: 0,
  isWaking: false,
  timer: undefined as undefined | { cancel?: () => void },
}

/** The notice of the changes not told yet, and forget them; undefined while there is none or the clicks are still coming. */
function takeNotice(now: number, isForced: boolean): string | undefined {
  const text = describeChanges(edits.pending, edits.isCleared)
  if (text === '') return undefined
  if (!isForced && now - edits.lastAt < NOTICE_DEBOUNCE_MS) return undefined
  edits.pending = {}
  edits.isCleared = false

  return text
}

async function stageChange($: any, all: Step[]): Promise<void> {
  edits.lastAt = await $.clock.now()
  await save($, all)
  if (!edits.isWaking) return
  edits.timer?.cancel?.()
  edits.timer = $.clock.after(NOTICE_DEBOUNCE_MS, async () => {
    try {
      const text = takeNotice(await $.clock.now(), true)
      if (text) await $.prompt.submit({ text })
    } catch { /* the notice goes with the next tool result or prompt instead */ }
  })
}

/** The person clicked the mark of step `idx` of the whole list. */
async function cycleStep($: any, idx: number): Promise<void> {
  let changed: Step | undefined
  let all: Step[] = []
  await update($, steps, (cur: Step[]) => {
    all = cur.map((x, j) => (j === idx ? (changed = { ...x, status: nextStatus(x.status) }) : x))

    return all
  })
  const hit = changed as Step | undefined
  if (hit === undefined) return
  edits.overrides[hit.title] = hit.status
  edits.pending[hit.title] = hit.status
  await stageChange($, all)
}

async function clearSteps($: any): Promise<void> {
  await update($, steps, () => [])
  edits.overrides = {}
  edits.view = {}
  edits.pending = {}
  edits.isCleared = true
  await stageChange($, [])
}

export const register: Register = (on, options) => {
  if (options.enabled === false || options.enabled === 'false') return // switched off: no tool, no advice, no pane
  view.isLine = options.view === 'line'
  view.columns = Number(options.paneColumns) > 0 ? Number(options.paneColumns) : 27
  diff.isEnabled = options.showDiff !== false && options.showDiff !== 'false'
  edits.isWaking = options.wakeOnChange === true || options.wakeOnChange === 'true'

  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'progress',
      description: DESCRIPTION,
      isDeferred: false,
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            description: 'The whole step list, in order.',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'At most 10 characters; a short noun phrase.', maxLength: 20 },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'] },
              },
              required: ['title', 'status'],
            },
          },
        },
        required: ['steps'],
      },
    })
    await $.command.register({ name: 'progress', description: 'Open the Progress pane' })

    // after a restart or --resume: the steps come back; the pane opens only for unfinished ones
    const kept = await load($)
    if (kept.length > 0) {
      await update($, steps, () => kept)
      if (hasOpenSteps(kept)) await openPane($)
    }
    await refreshChanges($, true)

    return next(e)
  })

  // the advice only where the built-in TodoWrite is not offered: with it, the model has its own habit
  on('prompt.compose', async ($, e, next) => {
    const out = await next(e)
    if (e.tools.includes('TodoWrite')) return out

    return { sections: [...out.sections, { id: 'progress-pane:advice', text: ADVICE, scope: 'session' as const }] }
  })

  on('command.run', { command: 'progress' }, async $ => {
    await openAlways($)

    return { text: 'Progress pane opened.' }
  })

  on('tool.call', { tool: TOOL }, async ($, e) => {
    if (e.agentId) return { result: 'Progress is shown for the main session only.' }
    const merged = mergeOverrides(clean((e as { steps?: unknown }).steps), edits.overrides, edits.view)
    const list = merged.list
    edits.overrides = merged.overrides
    edits.view = merged.view
    await update($, steps, () => list)
    await save($, list)
    await openPane($)
    const notice = takeNotice(0, true) // forced: the model is reading the list now, no debounce, no clock

    return { result: `Progress saved: ${countDone(list)} of ${list.length} done.${notice ? ` ${notice} Their status is kept.` : ''}` }
  }).catch(() => ({ result: 'Progress could not be saved; continue the task.' }))

  // the built-in list feeds the same pane
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId || ran.deny !== undefined || ran.isError === true) return ran
    const merged = mergeOverrides(fromTodos(e.todos), edits.overrides, edits.view)
    const todos = merged.list
    edits.overrides = merged.overrides
    edits.view = merged.view
    await update($, steps, () => todos)
    await save($, todos)
    await openPane($)

    return ran
  }).catch(async ($, e, next) => next(e))

  // after a tool that can change files, read the uncommitted changes again
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (DIFF_TOOLS.has(e.tool)) await refreshChanges($, false)
    const notice = takeNotice(await $.clock.now(), false)
    if (notice === undefined || (ran as { deny?: string }).deny !== undefined) return ran

    return { ...ran, context: [...((ran as { context?: readonly string[] }).context ?? []), notice] } as typeof ran
  }).catch(async ($, e, next) => next(e))

  // the person's own message: the notice goes along with it, whatever the debounce
  on('prompt.submit', async ($, e, next) => {
    const notice = takeNotice(await $.clock.now(), true)

    return next(notice === undefined ? e : { ...e, context: [...(e.context ?? []), notice] })
  }).catch(async ($, e, next) => next(e))

  // at the end of every turn: files may have changed outside this session's tools
  on('turn.complete', async ($, e, next) => {
    await refreshChanges($, true)

    return next(e)
  }).catch(async ($, e, next) => next(e))

  // view "line": one row above the prompt, no width taken from the conversation
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!view.isLine) return next(e)
    const list = await read($, steps)
    const open = list.find(s => s.status === 'in_progress') ?? list.find(s => s.status === 'pending')
    if (list.length === 0 || (open === undefined && countDone(list) === list.length)) return next(e)

    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text bold>Progress {countDone(list)}/{list.length}</Text>
        <Text dimColor> {MARK.in_progress} {open?.title ?? ''}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, steps)
    const folded = await read($, isFolded)

    const files = diff.isEnabled ? await read($, changes) : []

    if (list.length === 0 && files.length === 0) return <Text dimColor>No steps yet.</Text>

    const done = list.filter(s => s.status === 'done')
    const rest = list.filter(s => s.status !== 'done')
    const shown = folded ? rest : list
    const sum = totals(files)
    const shut = await read($, collapsedDirs)

    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {list.length > 0 && (
          <Box marginBottom={1}>
            <Box flexGrow={1}>
              <Text bold color="claude">Progress</Text>
              <Text dimColor> {done.length}/{list.length}</Text>
            </Box>
            <Button plain key="clear" onPress={() => clearSteps($)}>
              <Text dimColor>clear</Text>
            </Button>
          </Box>
        )}
        {done.length > 0 && (
          <Box marginBottom={1}>
            <Button plain key="fold" onPress={() => update($, isFolded, v => !v)}>
              <Text dimColor>
                {folded ? `${MARK.done} ${done.length} earlier steps ▸` : 'fold earlier steps ▾'}
              </Text>
            </Button>
          </Box>
        )}
        <Box flexDirection="column" gap={1}>
          {shown.map((s, i) => {
            const idx = list.indexOf(s)
            const isOpen = s.status === 'in_progress'

            // the mark and the title both press; a long title wraps beside the mark, under itself
            return (
              <Box key={String(i)}>
                <Button plain key={`mark:${i}`} onPress={() => cycleStep($, idx)}>
                  <Text color={MARK_COLOR[s.status]} bold={isOpen}>{MARK[s.status]} </Text>
                </Button>
                <Box flexShrink={1}>
                  <Button plain key={`title:${i}`} onPress={() => cycleStep($, idx)}>
                    <Text wrap="wrap" bold={isOpen} color={isOpen ? 'claude' : undefined} dimColor={!isOpen}>{s.title}</Text>
                  </Button>
                </Box>
              </Box>
            )
          })}
        </Box>
        {files.length > 0 && (
          <Box flexDirection="column" marginTop={list.length > 0 ? 1 : 0}>
            <Box marginBottom={1}>
              <Text bold color="claude">Changes</Text>
              <Text dimColor> {sum.files}</Text>
            </Box>
            {groupByDir(files.slice(0, DIFF_MAX_ROWS)).map(g => {
              const isCollapsed = shut.includes(g.dir)

              return (
                <Box key={g.dir} flexDirection="column">
                  <Box>
                    <Box flexGrow={1} flexShrink={1}>
                      <Button
                        plain
                        key={`dir:${g.dir}`}
                        onPress={() => update($, collapsedDirs, v => (v.includes(g.dir) ? v.filter(d => d !== g.dir) : [...v, g.dir]))}
                      >
                        <Text wrap="truncate-start">{isCollapsed ? '▸ ' : '▾ '}{g.dir}</Text>
                      </Button>
                    </Box>
                    {g.trackedCount > 0 && <Text color="success"> +{g.added}</Text>}
                    {g.trackedCount > 0 && <Text color="error"> -{g.removed}</Text>}
                    {g.newCount > 0 && <Text color="success"> {g.trackedCount > 0 ? '· ' : ''}{g.newCount} new</Text>}
                  </Box>
                  {!isCollapsed && g.files.map(f => (
                    <Box key={f.path} paddingLeft={2}>
                      <Box flexGrow={1} flexShrink={1}>
                        <Text wrap="truncate-start" dimColor>{baseName(f.path)}</Text>
                      </Box>
                      {f.kind === 'M' && <Text color="success"> +{f.added}</Text>}
                      {f.kind === 'M' && <Text color="error"> -{f.removed}</Text>}
                      {f.kind === 'N' && <Text color="success"> new</Text>}
                      {f.kind === 'B' && <Text dimColor> bin</Text>}
                    </Box>
                  ))}
                </Box>
              )
            })}
            {files.length > DIFF_MAX_ROWS && <Text dimColor>+{files.length - DIFF_MAX_ROWS} more</Text>}
            <Box marginTop={1}>
              <Box flexGrow={1}>
                <Text dimColor>total</Text>
              </Box>
              <Text color="success"> +{sum.added}</Text>
              <Text color="error"> -{sum.removed}</Text>
            </Box>
          </Box>
        )}
      </Box>
    )
  })
}
