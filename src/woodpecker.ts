// Small read-only Woodpecker API client
import type { Detail, RepoStatus, StepInfo } from './protocol'

type ApiRepo = { id: number; full_name: string; active?: boolean }
type ApiPipeline = {
  number: number
  status: string
  branch: string
  message: string
  event: string
  started: number
  finished: number
  errors?: { message: string; is_warning?: boolean }[]
  workflows?: {
    name: string
    children?: { id: number; name: string; state: string; exit_code: number; error?: string }[]
  }[]
}
type ApiLog = { data: string }

export type Conn = { url: string; token: string }

/** Base URL without trailing slashes */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

async function get<T>(conn: Conn, path: string): Promise<T> {
  const res = await fetch(`${normalizeUrl(conn.url)}/api${path}`, {
    headers: { Authorization: `Bearer ${conn.token}` },
    signal: AbortSignal.timeout(15000)
  })
  if (res.status === 401 || res.status === 403) throw new Error('Token invalid or lacks permission')
  if (!res.ok) throw new Error(`Woodpecker answered with ${res.status}`)
  return (await res.json()) as T
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

export async function fetchRepos(conn: Conn): Promise<RepoStatus[]> {
  const repos = await get<ApiRepo[]>(conn, '/user/repos')
  const base = normalizeUrl(conn.url)
  return mapLimit(repos, 5, async (repo) => {
    const [last] = await get<ApiPipeline[]>(conn, `/repos/${repo.id}/pipelines?perPage=1`).catch(
      () => [] as ApiPipeline[]
    )
    return {
      id: repo.id,
      name: repo.full_name,
      status: last?.status ?? null,
      number: last?.number ?? null,
      branch: last?.branch ?? '',
      message: (last?.message ?? '').split('\n')[0],
      event: last?.event ?? '',
      started: last?.started ?? 0,
      finished: last?.finished ?? 0,
      webUrl: last ? `${base}/repos/${repo.id}/pipeline/${last.number}` : `${base}/repos/${repo.id}`
    }
  })
}

const BAD_STATES = new Set(['failure', 'error', 'killed'])

function decode(data: string): string {
  try {
    return Buffer.from(data, 'base64').toString('utf8')
  } catch {
    return data
  }
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

  // Log excerpt of the first failed step
  let log = ''
  let logStep = ''
  const failed = (p.workflows ?? [])
    .flatMap((wf) => wf.children ?? [])
    .find((s) => BAD_STATES.has(s.state))
  if (failed) {
    logStep = failed.name
    const lines = await get<ApiLog[]>(conn, `/repos/${repoId}/logs/${number}/${failed.id}`).catch(
      () => [] as ApiLog[]
    )
    log = lines
      .map((l) => decode(l.data))
      .join('')
      .split('\n')
      .slice(-30)
      .join('\n')
      .trim()
  }
  return { errors, steps, log, logStep }
}
