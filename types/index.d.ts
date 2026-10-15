export type Step = { title: string; status: 'pending' | 'in_progress' | 'done' }

declare module 'claude-code' {
  interface PluginState {
    'progress-pane': { steps: Step[]; isFolded: boolean }
  }
}
