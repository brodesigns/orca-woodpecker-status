// Worker: polls Woodpecker for the CI status and answers the panel
import type { OrcaWorkerApi } from 'orca/worker'
import { checkServerUrl, isBad, isRunning, normalizeUrl, type CiState, type RepoStatus } from './protocol'
import { isLang, t, type Key, type Lang } from './i18n'
import { fetchDetail, fetchRepos, isValidToken, type Conn } from './woodpecker'

const SLOW_MS = 30_000
const FAST_MS = 10_000
const MAX_BACKOFF_MS = 120_000

/** Next poll delay: 10 s while something runs, 30 s otherwise; after errors 30 s, 60 s, 120 s (cap) */
export function nextInterval(errorCount: number, running: boolean): number {
  if (errorCount > 0) return Math.min(SLOW_MS * 2 ** (errorCount - 1), MAX_BACKOFF_MS)
  return running ? FAST_MS : SLOW_MS
}

/** What we remember per repo: the latest pipeline and the result of the last finished one */
export type Seen = { key: string; lastDone: string | null }
export type Change = 'failed' | 'recovered' | null

/**
 * Compares a repo with what we saw before. A repo seen for the first time (first poll or a
 * new repo) never notifies, it only sets the baseline.
 */
export function evaluateChange(prev: Seen | undefined, r: Pick<RepoStatus, 'number' | 'status'>): { next: Seen; change: Change } {
  const done = isBad(r.status) || r.status === 'success'
  const next: Seen = { key: `${r.number}:${r.status}`, lastDone: done ? r.status : (prev?.lastDone ?? null) }
  if (!prev || prev.key === next.key) return { next, change: null }
  if (isBad(r.status)) return { next, change: 'failed' }
  if (r.status === 'success' && isBad(prev.lastDone)) return { next, change: 'recovered' }
  return { next, change: null }
}

export default function activate(orca: OrcaWorkerApi): void {
  let state: CiState = { configured: false, error: null, repos: [], updatedAt: 0, truncated: false }
  let timer: ReturnType<typeof setTimeout> | undefined
  let lang: Lang = 'en'
  let errorCount = 0

  // Last known pipeline per repo, to detect a switch to red or back to green
  const seen = new Map<number, Seen>()
  // Seen keys depend on this setting, so a change starts a new baseline
  let seenBranchMode: boolean | null = null

  async function boolSetting(key: string, fallback: boolean): Promise<boolean> {
    const v = await orca.settings.get(key).catch(() => null)
    return typeof v === 'boolean' ? v : fallback
  }

  async function updateStatusBar(): Promise<void> {
    const bad = state.repos.filter((r) => isBad(r.status)).length
    const run = state.repos.filter((r) => isRunning(r.status)).length
    let text = t(lang, 'barOk')
    let tone: 'success' | 'danger' | 'warning' | 'neutral' = 'success'
    if (!state.configured) [text, tone] = [t(lang, 'barSetup'), 'neutral']
    else if (state.error && !state.repos.length) [text, tone] = [t(lang, 'barError'), 'danger']
    else if (bad) [text, tone] = [t(lang, 'barFailed', { n: bad }), 'danger']
    else if (run) [text, tone] = [t(lang, 'barRunning', { n: run }), 'warning']
    await orca.host
      .call('statusBar.update', { id: 'ci', text, tone, tooltip: t(lang, 'nProjects', { n: state.repos.length }) })
      .catch((e) => orca.log(`statusBar failed: ${String(e)}`))
  }

  /** Only called after a successful poll; repos whose request failed keep their old baseline */
  async function notifyChanges(failed: number[]): Promise<void> {
    const notifyRecovered = await boolSetting('notifyRecovered', true)
    // Forget repos that are gone, so the map cannot grow forever
    const ids = new Set(state.repos.map((r) => r.id))
    for (const id of seen.keys()) if (!ids.has(id)) seen.delete(id)
    const skip = new Set(failed)
    for (const r of state.repos) {
      if (skip.has(r.id)) continue
      const { next, change } = evaluateChange(seen.get(r.id), r)
      seen.set(r.id, next)
      if (!change || (change === 'recovered' && !notifyRecovered)) continue
      const key: Key = change === 'failed' ? 'notifyFailed' : 'notifyRecovered'
      await orca.host
        .call('notifications.show', { title: t(lang, key, { name: r.name }), body: r.message || r.branch })
        .catch((e) => orca.log(`notify failed: ${String(e)}`))
    }
  }

  async function conn(): Promise<Conn | null> {
    const url = await orca.settings.get('serverUrl')
    const token = await orca.secrets.get('token')
    if (typeof url !== 'string' || !url.trim() || !token) return null
    return { url: normalizeUrl(url), token }
  }

  // If a poll is already running, reuse it instead of starting a second one
  let inFlight: Promise<void> | null = null
  function poll(): Promise<void> {
    inFlight ??= doPoll().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  async function doPoll(): Promise<void> {
    clearTimeout(timer)
    const c = await conn()
    if (!c) {
      state = { configured: false, error: null, repos: [], updatedAt: Date.now(), truncated: false }
      errorCount = 0
    } else {
      try {
        const defaultBranchOnly = await boolSetting('defaultBranchOnly', false)
        if (seenBranchMode !== defaultBranchOnly) seen.clear()
        seenBranchMode = defaultBranchOnly
        const res = await fetchRepos(c, { previous: state.repos, defaultBranchOnly })
        state = { configured: true, error: null, repos: res.repos, updatedAt: Date.now(), truncated: res.truncated }
        errorCount = 0
        if (res.failed.length) orca.log(`pipeline request failed for ${res.failed.length} repo(s), kept last status`)
        await notifyChanges(res.failed)
      } catch (err) {
        // Keep showing the old data, only add the error
        state = { ...state, configured: true, error: String(err instanceof Error ? err.message : err) }
        errorCount++
        orca.log(`poll failed: ${state.error}`)
      }
    }
    await updateStatusBar()
    orca.panels.post('status.changed', state)
    timer = setTimeout(() => void poll(), nextInterval(errorCount, state.repos.some((r) => isRunning(r.status))))
  }

  orca.panels.handle('config.get', async () => {
    const url = await orca.settings.get('serverUrl')
    return { url: typeof url === 'string' ? url : '', hasToken: !!(await orca.secrets.get('token')), lang }
  })

  orca.panels.handle('lang.set', async (input) => {
    if (!isLang(input?.lang)) throw new Error('Invalid language')
    lang = input.lang
    await orca.settings.set('language', lang)
    await updateStatusBar()
    return { ok: true as const }
  })

  orca.panels.handle('config.save', async ({ url, token }) => {
    if (typeof url !== 'string' || typeof token !== 'string') throw new Error('Invalid input')
    const urlError = checkServerUrl(url)
    if (urlError) throw new Error(urlError)
    if (token.trim() && !isValidToken(token.trim())) throw new Error('Token contains invalid characters')
    const oldUrl = await orca.settings.get('serverUrl')
    if (typeof oldUrl !== 'string' || normalizeUrl(oldUrl) !== normalizeUrl(url)) {
      // Another server: old repo ids mean nothing there
      state = { ...state, repos: [], truncated: false }
      seen.clear()
    }
    await orca.settings.set('serverUrl', normalizeUrl(url))
    // An empty token field keeps the stored token
    if (token.trim()) await orca.secrets.set('token', token.trim())
    void poll()
    return { ok: true as const }
  })

  orca.panels.handle('status.get', async () => state)
  orca.panels.handle('status.refresh', async () => {
    await poll()
    return state
  })

  orca.panels.handle('detail.get', async ({ repoId, number }) => {
    // Positive integers only, otherwise the API path could be manipulated
    if (!Number.isSafeInteger(repoId) || repoId < 1 || !Number.isSafeInteger(number) || number < 1) {
      throw new Error('Invalid repo or pipeline number')
    }
    const c = await conn()
    if (!c) throw new Error('Not set up')
    return fetchDetail(c, repoId, number)
  })

  orca.commands.register('refresh', async () => {
    await poll()
    return 'Refreshed'
  })

  void (async () => {
    const saved = await orca.settings.get('language').catch(() => null)
    if (isLang(saved)) lang = saved
    await poll()
  })()
}

export function deactivate(): void {}
