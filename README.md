# progress-pane

A Progress pane for Claude Code: the steps of the current task, at a glance, on the right side of the conversation (or as one row above the prompt).

## What it does

- Registers a tool `mcp__progress-pane__progress`. The model sends the whole step list (`title`, `status` of `pending`, `in_progress` or `done`) and the pane redraws.
- Also reads the built-in `TodoWrite`, when the model has it, into the same pane.
- Adds one short advice to the system prompt (only where `TodoWrite` is not offered): call the tool for a task of 3 or more steps. No CLAUDE.md needed.
- Under the steps, a Changes list grouped by directory (a click folds a directory; the fold is kept for the session, not across restarts): uncommitted files with `+added -removed`, read after Edit, Write, Bash and similar tools, and at the end of every turn. Not the commits of this session.
- Done steps fold into one line `✓ N earlier steps`; a click unfolds them. Long titles wrap beside their mark.
- The steps are kept in the plugin's store, one record per session, the newest 20 sessions. After a restart or `--resume` they come back; the pane opens by itself only while a step is unfinished. A new session (or `/clear`) starts empty.
- `/progress` opens the pane at any width. Opened by itself, the dock needs a terminal of 110 to 144 columns.

## Editing the steps by hand

- Click a step's mark (or its title) to change its status: pending, in progress, done, pending. `clear` in the header empties the list.
- A step you changed keeps your status over the model's next list, until the model sends a different status for that step than it sent before (it changed it on purpose).
- The model is told, once, 1.5 s after your last click. The notice (`The person changed the progress list: "step" -> done.`) is added, whichever comes first, to the next tool result, to your next message, or to the progress tool's answer. Several clicks are merged into one notice.
- Option `wakeOnChange` also starts a turn of its own so the model reads the change at once. Off by default.

## Options

```json
"pluginConfigs": { "progress-pane": { "options": { "view": "line", "paneColumns": 24 } } }
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false`: registers nothing (no tool, no advice, no pane) |
| `showDiff` | `true` | List the uncommitted files (`+added -removed` against HEAD, plus new files) under the steps |
| `view` | `pane` | `pane`: docked pane on the right. `line`: one row above the prompt, no width taken |
| `paneColumns` | `27` | Width the docked pane asks for (10 to 120). A width you drag it to wins |
| `wakeOnChange` | `false` | After you change a step, start a turn of its own so the model reads the change at once |

Options are read when the plugin loads; reload or restart after a change.

## Limits

- The frame (left bar, close mark) is drawn by the engine; only the body is this plugin's.
- A pane is docked beside the transcript or above the prompt; it cannot float over the conversation.
- The steps are what the model writes. Whether it keeps them current is the model's habit, not enforced.
- Your edits that the model has not yet overwritten are held in memory: after a restart the saved list comes back with them, but the rule "your status wins over the model's next list" starts over.
- Under `view: line` the Changes list and the clickable steps are not drawn; only the one-row band is.

## Verification status

Checked in a real session (Windows, Claude Code 2.1.300), 2026-10-16:

| What | Result |
| --- | --- |
| Steps from the progress tool, pane drawn, long titles wrap | works |
| Steps kept across restart; `--resume` brings them back, the pane opens only for unfinished ones | works |
| New session starts empty; all steps done: no auto-open, `/progress` still opens it | works |
| Changes list from `git diff HEAD` and untracked files; directory groups fold; all-new groups show `N new`; `total` row | works |
| Click a mark to cycle the status; `clear` empties the list | works |
| Notice reaches the model: with the next message, with the next tool result, in the progress tool's answer | works |
| Your status wins over the model's next list unless the model changed that step | works (checked by the pane's colours and marks) |
| 1.5 s debounce | behaves as expected, not timed |

Not checked:

- `wakeOnChange` (starting a turn of its own).
- `--resume` after an edit by hand: whether your status survives and is told to the model again.
- A repository with many changed files (the list is cut at 12 files, `+N more`) and the cost of `git` on a large one.
- `view: line` with the click editing, and a WSL terminal (the plugin is installed there, not driven).
- Colours depend on the terminal theme (`success` may not be green).

Automated tests (`claude plugin test`) cover the step cleaning, the session index, the status cycle and merge rule, the notice text, and the git output parsing and grouping. They do not draw anything.

## Layout

```text
.claude-plugin/plugin.json
hooks/hooks.json     # { "modules": ["./register.tsx"] }
hooks/register.tsx   # tool, TodoWrite hook, prompt advice, pane and band drawing
hooks/steps.ts       # pure helpers
types/index.d.ts     # contract of the pane's state
tests/progress.test.ts
```
