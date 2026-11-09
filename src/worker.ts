// Worker: polls Woodpecker for the CI status and answers the panel
import type { OrcaWorkerApi } from 'orca/worker'
import type { CiState } from './protocol'
import { isLang, t, type Lang } from './i18n'
import { checkServerUrl, fetchDetail, fetchRepos, isValidToken, normalizeUrl, type Conn } from './woodpecker'

const SLOW_MS = 30_000
const FAST_MS = 10_000
const RUNNING = new Set(['running', 'pending', 'started'])
const BAD = new Set(['failure', 'error', 'killed'])

export default function activate(orca: OrcaWorkerApi): void {
  let state: CiState = { configured: false, error: null, repos: [], updatedAt: 0 }
  let timer: ReturnType<typeof setTimeout> | undefined
  let lang: Lang = 'en'

  // Last known pipeline per repo ("number:status"), to detect a switch to red
  const seen = new Map<number, string>()
  let firstPoll = true

  async function updateStatusBar(): Promise<void> {
    const bad = state.repos.filter((r) => r.status && BAD.has(r.status)).length
    const run = state.repos.filter((r) => r.status && RUNNING.has(r.status)).length
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

  async function notifyChanges(): Promise<void> {
    // Forget repos that are gone, so the map cannot grow forever
    const ids = new Set(state.repos.map((r) => r.id))
    for (const id of seen.keys()) if (!ids.has(id)) seen.delete(id)
    for (const r of state.repos) {
      const key = `${r.number}:${r.status}`
      const prev = seen.get(r.id)
      seen.set(r.id, key)
      // The first poll and unchanged pipelines notify nothing
      if (firstPoll || prev === key || !r.status || !BAD.has(r.status)) continue
      await orca.host
        .call('notifications.show', { title: t(lang, 'notifyFailed', { name: r.name }), body: r.message || r.branch })
        .catch((e) => orca.log(`notify failed: ${String(e)}`))
    }
    if (state.configured && !state.error) firstPoll = false
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
      state = { configured: false, error: null, repos: [], updatedAt: Date.now() }
    } else {
      try {
        const repos = await fetchRepos(c)
        state = { configured: true, error: null, repos, updatedAt: Date.now() }
      } catch (err) {
        // Keep showing the old data, only add the error
        state = { ...state, configured: true, error: String(err instanceof Error ? err.message : err) }
        orca.log(`poll failed: ${state.error}`)
      }
    }
    await notifyChanges()
    await updateStatusBar()
    orca.panels.post('status.changed', state)
    const running = state.repos.some((r) => r.status && RUNNING.has(r.status))
    timer = setTimeout(() => void poll(), running ? FAST_MS : SLOW_MS)
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
