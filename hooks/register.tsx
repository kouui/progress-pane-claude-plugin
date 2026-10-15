import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { DiffFile, Step } from '../types'

import { baseName, mergeFiles, parseNumstat, parseUntracked, totals } from './diff'
import { MARK, clean, countDone, fromTodos, hasOpenSteps, touch } from './steps'

const PANE = 'progress'
const TOOL = 'mcp__progress-pane__progress'
const steps = atom({ plugin: 'progress-pane', key: 'steps' } as const, [])
const isFolded = atom({ plugin: 'progress-pane', key: 'isFolded' } as const, true)
const changes = atom({ plugin: 'progress-pane', key: 'diff' } as const, [])

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

export const register: Register = (on, options) => {
  if (options.enabled === false || options.enabled === 'false') return // switched off: no tool, no advice, no pane
  view.isLine = options.view === 'line'
  view.columns = Number(options.paneColumns) > 0 ? Number(options.paneColumns) : 27
  diff.isEnabled = options.showDiff !== false && options.showDiff !== 'false'

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
    const list = clean((e as { steps?: unknown }).steps)
    await update($, steps, () => list)
    await save($, list)
    await openPane($)

    return { result: `Progress saved: ${countDone(list)} of ${list.length} done.` }
  }).catch(() => ({ result: 'Progress could not be saved; continue the task.' }))

  // the built-in list feeds the same pane
  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId || ran.deny !== undefined || ran.isError === true) return ran
    const todos = fromTodos(e.todos)
    await update($, steps, () => todos)
    await save($, todos)
    await openPane($)

    return ran
  }).catch(async ($, e, next) => next(e))

  // after a tool that can change files, read the uncommitted changes again
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (DIFF_TOOLS.has(e.tool)) await refreshChanges($, false)

    return ran
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

    return (
      <Box flexDirection="column" paddingX={1} paddingTop={1}>
        {list.length > 0 && (
          <Box marginBottom={1}>
            <Text bold color="claude">Progress</Text>
            <Text dimColor> {done.length}/{list.length}</Text>
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
          {shown.map((s, i) => (
            // the mark keeps its own cell; a long title wraps beside it, under itself
            <Box key={String(i)}>
              <Text color={MARK_COLOR[s.status]} bold={s.status === 'in_progress'}>{MARK[s.status]} </Text>
              <Box flexShrink={1}>
                <Text
                  wrap="wrap"
                  bold={s.status === 'in_progress'}
                  color={s.status === 'in_progress' ? 'claude' : undefined}
                  dimColor={s.status !== 'in_progress'}
                >
                  {s.title}
                </Text>
              </Box>
            </Box>
          ))}
        </Box>
        {files.length > 0 && (
          <Box flexDirection="column" marginTop={list.length > 0 ? 1 : 0}>
            <Box marginBottom={1}>
              <Text bold color="claude">Changes</Text>
              <Text dimColor> {sum.files}</Text>
            </Box>
            {files.slice(0, DIFF_MAX_ROWS).map(f => (
              <Box key={f.path}>
                <Box flexGrow={1} flexShrink={1}>
                  <Text wrap="truncate-start" dimColor>{baseName(f.path)}</Text>
                </Box>
                {f.kind === 'M' && <Text color="success"> +{f.added}</Text>}
                {f.kind === 'M' && <Text color="error"> -{f.removed}</Text>}
                {f.kind === 'N' && <Text color="success"> new</Text>}
                {f.kind === 'B' && <Text dimColor> bin</Text>}
              </Box>
            ))}
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
