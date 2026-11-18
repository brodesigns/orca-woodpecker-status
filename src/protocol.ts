// Panel <-> worker contract, declared once. Also holds the small rules both sides share.

/** Pipeline states that are still in progress */
export const RUNNING_STATES: ReadonlySet<string> = new Set(['running', 'pending', 'started'])
/** Pipeline states that count as failed */
export const BAD_STATES: ReadonlySet<string> = new Set(['failure', 'error', 'killed'])

export function isRunning(status: string | null | undefined): boolean {
  return !!status && RUNNING_STATES.has(status)
}

export function isBad(status: string | null | undefined): boolean {
  return !!status && BAD_STATES.has(status)
}

/** Base URL without trailing slashes */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/** Hosts where plain http is allowed, because the token never leaves the machine */
export function isLocalHost(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]'].includes(hostname)
}

/** The token is only sent over https. Plain http is allowed for localhost only. Returns an error text or null. */
export function checkServerUrl(url: string): string | null {
  let u: URL
  try {
    u = new URL(normalizeUrl(url))
  } catch {
    return 'Invalid server URL'
  }
  if (u.protocol === 'https:' || (u.protocol === 'http:' && isLocalHost(u.hostname))) return null
  return 'Server URL must use https:// (http:// is only allowed for localhost)'
}

export type RepoStatus = {
  id: number
  name: string
  /** Status of the latest pipeline, null if the repo has none yet */
  status: string | null
  number: number | null
  branch: string
  /** Short commit hash (7 characters) of the pipeline, empty if unknown */
  commit: string
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
  /** True if the account has more active repos than the plugin shows (MAX_REPOS) */
  truncated: boolean
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
  /** Last log lines of every failed step (max. 3 steps), ANSI codes removed */
  logs: StepLog[]
  /** Deprecated: same as logs[0].text, kept until the panel uses `logs` */
  log: string
  /** Deprecated: same as logs[0].step */
  logStep: string
}

export type StepLog = { step: string; text: string }

declare module 'orca' {
  interface PluginRequests {
    'config.get': { output: { url: string; hasToken: boolean; lang: 'en' | 'de' } }
    'lang.set': { input: { lang: 'en' | 'de' }; output: { ok: true } }
    'config.save': { input: { url: string; token: string }; output: { ok: true } }
    'status.get': { output: CiState }
    'status.refresh': { output: CiState }
    'detail.get': { input: { repoId: number; number: number }; output: Detail }
  }
  interface PluginPanelEvents {
    'status.changed': CiState
  }
}
