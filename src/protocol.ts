// Panel <-> worker contract, declared once
export {}

export type RepoStatus = {
  id: number
  name: string
  /** Status of the latest pipeline, null if the repo has none yet */
  status: string | null
  number: number | null
  branch: string
  message: string
  event: string
  started: number
  finished: number
  /** Link to the pipeline in the Woodpecker web UI */
  webUrl: string
}

export type CiState = {
  configured: boolean
  /** Error of the last poll (e.g. wrong token) */
  error: string | null
  repos: RepoStatus[]
  updatedAt: number
}

export type StepInfo = {
  workflow: string
  name: string
  state: string
  exitCode: number
  error: string
}

export type Detail = {
  /** Pipeline-level errors (configuration, linter) */
  errors: string[]
  steps: StepInfo[]
  /** Last log lines of the first failed step */
  log: string
  logStep: string
}

declare module 'orca' {
  interface PluginRequests {
    'config.get': { output: { url: string; hasToken: boolean } }
    'config.save': { input: { url: string; token: string }; output: { ok: true } }
    'status.get': { output: CiState }
    'status.refresh': { output: CiState }
    'detail.get': { input: { repoId: number; number: number }; output: Detail }
  }
  interface PluginPanelEvents {
    'status.changed': CiState
  }
}
