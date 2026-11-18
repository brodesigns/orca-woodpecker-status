// Small read-only Woodpecker API client
import { BAD_STATES, checkServerUrl, normalizeUrl, type Detail, type RepoStatus, type StepInfo, type StepLog } from './protocol'

export { checkServerUrl, normalizeUrl } from './protocol'

type ApiRepo = { id: number; full_name: string; active?: boolean; default_branch?: string }
type ApiPipeline = {
  number: number
  status: string
  branch: string
  commit?: string
  message?: string
  event?: string
  started?: number
  finished?: number
  errors?: { message: string; is_warning?: boolean }[]
  workflows?: {
    name: string
    children?: { id: number; name: string; state: string; exit_code: number; error?: string }[]
  }[]
}
type ApiLog = { data: string }

export type Conn = { url: string; token: string }

export type FetchOptions = {
  /** Repos of the last poll: a repo whose request fails keeps its last known status */
  previous?: RepoStatus[]
  /** Use the latest pipeline on the repo's default branch instead of any branch */
  defaultBranchOnly?: boolean
}

export type FetchResult = {
  repos: RepoStatus[]
  /** More active repos than MAX_REPOS */
  truncated: boolean
  /** Repos whose pipeline request failed in this poll (status is the previous one or null) */
  failed: number[]
}

/** A token may only contain visible ASCII characters (no line breaks or spaces) */
export function isValidToken(token: string): boolean {
  return /^[\x21-\x7E]+$/.test(token)
}

const MAX_BODY_BYTES = 5 * 1024 * 1024
export const MAX_REPOS = 200
const MAX_LOG_ENTRIES = 400
const MAX_LOG_STEPS = 3
const MAX_LOG_LINES = 30

/** Reads a response body but stops with an error once it grows past the limit */
async function readLimited(res: Response): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? 0)
  if (declared > MAX_BODY_BYTES) throw new Error('Response too large')
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BODY_BYTES) {
      await reader.cancel()
      throw new Error('Response too large')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

async function get<T>(conn: Conn, path: string): Promise<T> {
  const urlError = checkServerUrl(conn.url)
  if (urlError) throw new Error(urlError)
  // Fixed error text: the original message of fetch can contain the token
  const res = await fetch(`${normalizeUrl(conn.url)}/api${path}`, {
    headers: { Authorization: `Bearer ${conn.token}` },
    // Never follow redirects: the token must only ever reach the configured server
    redirect: 'manual',
    signal: AbortSignal.timeout(15000)
  }).catch(() => {
    throw new Error('Request failed (server unreachable or timed out)')
  })
  if (res.status >= 300 && res.status < 400) {
    throw new Error('The server redirects. Enter the final https:// URL of your Woodpecker server.')
  }
  if (res.status === 401 || res.status === 403) throw new Error('Token invalid or lacks permission')
  if (!res.ok) throw new Error(`Woodpecker answered with ${res.status}`)
  try {
    return JSON.parse(await readLimited(res)) as T
  } catch (err) {
    if (err instanceof Error && err.message === 'Response too large') throw err
    throw new Error('Invalid answer from Woodpecker')
  }
}

async function getList<T>(conn: Conn, path: string): Promise<T[]> {
  const list = await get<unknown>(conn, path)
  if (!Array.isArray(list)) throw new Error('Invalid answer from Woodpecker')
  return list as T[]
}

/** Runs fn for every item, at most `limit` at a time */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return out
}

const isInt = (v: unknown): v is number => Number.isSafeInteger(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/** Feed item -> pipeline, or null if a required field is missing */
function feedPipeline(item: unknown): (ApiPipeline & { repo_id: number }) | null {
  if (!item || typeof item !== 'object') return null
  const f = item as Record<string, unknown>
  if (!isInt(f.repo_id) || !isInt(f.number) || typeof f.status !== 'string' || typeof f.branch !== 'string') return null
  return {
    repo_id: f.repo_id,
    number: f.number,
    status: f.status,
    branch: f.branch,
    commit: str(f.commit),
    message: str(f.message),
    event: str(f.event),
    started: num(f.started),
    finished: num(f.finished)
  }
}

/**
 * Latest pipeline per repo from GET /user/feed (one request for all repos).
 * Works with both answers Woodpecker gives: one item per repo (latest=true) or the newest
 * pipelines across all repos; the highest number per repo wins. Empty map on any error.
 */
async function fetchFeed(conn: Conn): Promise<Map<number, ApiPipeline>> {
  const out = new Map<number, ApiPipeline>()
  const items = await getList<unknown>(conn, '/user/feed?latest=true').catch(() => [] as unknown[])
  for (const item of items) {
    const p = feedPipeline(item)
    if (!p) continue
    const known = out.get(p.repo_id)
    if (!known || p.number > known.number) out.set(p.repo_id, p)
  }
  return out
}

/** Latest pipeline of one repo, optionally only on one branch; null if there is none */
async function fetchLatest(conn: Conn, repoId: number, branch: string): Promise<ApiPipeline | null> {
  if (!branch) {
    const [last] = await getList<ApiPipeline>(conn, `/repos/${repoId}/pipelines?perPage=1`)
    return last ?? null
  }
  // Check the branch ourselves too, in case the server ignores the filter
  const list = await getList<ApiPipeline>(conn, `/repos/${repoId}/pipelines?branch=${encodeURIComponent(branch)}&perPage=10`)
  return list.find((p) => p.branch === branch) ?? null
}

function toStatus(base: string, repo: ApiRepo, last: ApiPipeline | null): RepoStatus {
  return {
    id: repo.id,
    name: repo.full_name,
    status: last?.status ?? null,
    number: last?.number ?? null,
    branch: last?.branch ?? '',
    commit: (last?.commit ?? '').slice(0, 7),
    message: (last?.message ?? '').split('\n')[0],
    event: last?.event ?? '',
    started: last?.started ?? 0,
    finished: last?.finished ?? 0,
    webUrl: last ? `${base}/repos/${repo.id}/pipeline/${last.number}` : `${base}/repos/${repo.id}`
  }
}

export async function fetchRepos(conn: Conn, opts: FetchOptions = {}): Promise<FetchResult> {
  const [all, feed] = await Promise.all([getList<ApiRepo>(conn, '/user/repos'), fetchFeed(conn)])
  // Inactive repos have no pipelines in Woodpecker, so they cost requests for nothing
  const active = all.filter((r) => r && isInt(r.id) && r.active !== false)
  const repos = active.slice(0, MAX_REPOS)
  const previous = new Map((opts.previous ?? []).map((r) => [r.id, r]))
  const base = normalizeUrl(conn.url)
  const failed: number[] = []

  const list = await mapLimit(repos, 5, async (repo) => {
    const branch = opts.defaultBranchOnly ? str(repo.default_branch) : ''
    const fromFeed = feed.get(repo.id)
    // The feed holds the latest pipeline of any branch; it only fits if it is on the wanted branch
    if (fromFeed && (!branch || fromFeed.branch === branch)) return toStatus(base, repo, fromFeed)
    try {
      return toStatus(base, repo, await fetchLatest(conn, repo.id, branch))
    } catch {
      // A failed request is not "no pipeline": keep what we knew
      failed.push(repo.id)
      return previous.get(repo.id) ?? toStatus(base, repo, null)
    }
  })
  return { repos: list, truncated: active.length > repos.length, failed }
}

function decode(data: string): string {
  try {
    const bin = atob(data)
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
  } catch {
    return data
  }
}

/** Removes ANSI escape sequences (colors, cursor moves, OSC titles and links) */
export function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-Z\\-_]/g, '')
}

/** Last lines of a step log as plain text; for "\r" progress lines only the final state is kept */
export function logExcerpt(entries: ApiLog[], maxLines = MAX_LOG_LINES): string {
  return stripAnsi(entries.slice(-MAX_LOG_ENTRIES).map((l) => decode(str(l?.data))).join(''))
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.split('\r').pop() ?? '')
    .slice(-maxLines)
    .join('\n')
    .trim()
}

export async function fetchDetail(conn: Conn, repoId: number, number: number): Promise<Detail> {
  const p = await get<ApiPipeline>(conn, `/repos/${repoId}/pipelines/${number}`)
  const steps: StepInfo[] = []
  for (const wf of p.workflows ?? []) {
    for (const s of wf.children ?? []) {
      steps.push({
        workflow: wf.name,
        name: s.name,
        state: s.state,
        exitCode: s.exit_code,
        error: s.error ?? ''
      })
    }
  }
  const errors = (p.errors ?? []).filter((e) => !e.is_warning).map((e) => e.message)

  // Log excerpt of the failed steps (at most MAX_LOG_STEPS)
  const failed = (p.workflows ?? [])
    .flatMap((wf) => wf.children ?? [])
    .filter((s) => BAD_STATES.has(s.state) && isInt(s.id))
    .slice(0, MAX_LOG_STEPS)
  const logs: StepLog[] = await Promise.all(
    failed.map(async (s) => {
      const entries = await getList<ApiLog>(conn, `/repos/${repoId}/logs/${number}/${s.id}`).catch(() => [] as ApiLog[])
      return { step: s.name, text: logExcerpt(entries) }
    })
  )
  return { errors, steps, logs, log: logs[0]?.text ?? '', logStep: logs[0]?.step ?? '' }
}
