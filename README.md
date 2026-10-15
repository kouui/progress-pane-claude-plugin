# progress-pane

A Progress pane for Claude Code: the steps of the current task, at a glance, on the right side of the conversation (or as one row above the prompt).

## What it does

- Registers a tool `mcp__progress-pane__progress`. The model sends the whole step list (`title`, `status` of `pending`, `in_progress` or `done`) and the pane redraws.
- Also reads the built-in `TodoWrite`, when the model has it, into the same pane.
- Adds one short advice to the system prompt (only where `TodoWrite` is not offered): call the tool for a task of 3 or more steps. No CLAUDE.md needed.
- Done steps fold into one line `✓ N earlier steps`; a click unfolds them. Long titles wrap beside their mark.
- The steps are kept in the plugin's store, one record per session, the newest 20 sessions. After a restart or `--resume` they come back; the pane opens by itself only while a step is unfinished. A new session (or `/clear`) starts empty.
- `/progress` opens the pane at any width. Opened by itself, the dock needs a terminal of 110 to 144 columns.

## Options

```json
"pluginConfigs": { "progress-pane": { "options": { "view": "line", "paneColumns": 24 } } }
```

| Option | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | `false`: registers nothing (no tool, no advice, no pane) |
| `view` | `pane` | `pane`: docked pane on the right. `line`: one row above the prompt, no width taken |
| `paneColumns` | `18` | Width the docked pane asks for (10 to 120). A width you drag it to wins |

Options are read when the plugin loads; reload or restart after a change.

## Limits

- The frame (left bar, close mark) is drawn by the engine; only the body is this plugin's.
- A pane is docked beside the transcript or above the prompt; it cannot float over the conversation.
- The steps are what the model writes. Whether it keeps them current is the model's habit, not enforced.
- Whether `--resume` keeps the session id (so the steps come back) is by the engine's own doc, not tested here.
- Tests cover the step cleaning, the session index and the tool's answer; colours, spacing and clicks were checked by eye only.

## Layout

```text
.claude-plugin/plugin.json
hooks/hooks.json     # { "modules": ["./register.tsx"] }
hooks/register.tsx   # tool, TodoWrite hook, prompt advice, pane and band drawing
hooks/steps.ts       # pure helpers
types/index.d.ts     # contract of the pane's state
tests/progress.test.ts
```
