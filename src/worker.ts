// Worker: polls Woodpecker for the CI status and answers the panel
import type { OrcaWorkerApi } from 'orca/worker'
import type { CiState } from './protocol'
import { checkServerUrl, fetchDetail, fetchRepos, normalizeUrl, type Conn } from './woodpecker'

const SLOW_MS = 30_000
const FAST_MS = 10_000
const RUNNING = new Set(['running', 'pending', 'started'])
const BAD = new Set(['failure', 'error', 'killed'])

export default function activate(orca: OrcaWorkerApi): void {
  let state: CiState = { configured: false, error: null, repos: [], updatedAt: 0 }
  let timer: ReturnType<typeof setTimeout> | undefined

  // Last known pipeline per repo ("number:status"), to detect a switch to red
  const seen = new Map<number, string>()
  let firstPoll = true

  async function updateStatusBar(): Promise<void> {
    const bad = state.repos.filter((r) => r.status && BAD.has(r.status)).length
    const run = state.repos.filter((r) => r.status && RUNNING.has(r.status)).length
    let text = 'CI ok'
    let tone: 'success' | 'danger' | 'warning' | 'neutral' = 'success'
    if (!state.configured) [text, tone] = ['CI setup', 'neutral']
    else if (state.error && !state.repos.length) [text, tone] = ['CI error', 'danger']
    else if (bad) [text, tone] = [`CI ${bad} failed`, 'danger']
    else if (run) [text, tone] = [`CI ${run} running`, 'warning']
    await orca.host
      .call('statusBar.update', { id: 'ci', text, tone, tooltip: `${state.repos.length} projects` })
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
        .call('notifications.show', { title: `CI failed: ${r.name}`, body: r.message || r.branch })
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

  async function poll(): Promise<void> {
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
    return { url: typeof url === 'string' ? url : '', hasToken: !!(await orca.secrets.get('token')) }
  })

  orca.panels.handle('config.save', async ({ url, token }) => {
    const urlError = checkServerUrl(url)
    if (urlError) throw new Error(urlError)
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
    const c = await conn()
    if (!c) throw new Error('Not set up')
    return fetchDetail(c, repoId, number)
  })

  orca.commands.register('refresh', async () => {
    await poll()
    return 'Refreshed'
  })

  void poll()
}

export function deactivate(): void {}
