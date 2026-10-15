export type Step = { title: string; status: 'pending' | 'in_progress' | 'done' }

/** One changed file: `M` tracked and changed, `N` new and untracked, `B` binary. */
export type DiffFile = { path: string; added: number; removed: number; kind: 'M' | 'N' | 'B' }

declare module 'claude-code' {
  interface PluginState {
    'progress-pane': { steps: Step[]; isFolded: boolean; diff: DiffFile[] }
  }
}
