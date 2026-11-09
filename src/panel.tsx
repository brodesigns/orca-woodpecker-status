// Panel: project list with status, setup and error details (no build step)
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Code,
  Collapsible,
  Heading,
  IconButton,
  Input,
  Link,
  plugin,
  read,
  Row,
  Select,
  set,
  Skeleton,
  Stack,
  Text,
  type PanelContext,
  type Tone
} from 'orca'
import type { CiState, Detail, RepoStatus } from './protocol'
import { errorText, isLang, t, type Key, type Lang } from './i18n'

const ci = atom<CiState | null>(null)
const form = atom<{ url: string; token: string; hasToken: boolean; edit: boolean } | null>(null)
const details = atom<Record<string, Detail | 'loading' | 'error'>>({})
const refreshing = atom(false)
const saveError = atom('')
const lang = atom<Lang>('lang', 'en')

/** Text in the chosen language */
const tr = (key: Key, vars?: Record<string, string | number>): string => t(read(lang), key, vars)
const query = atom('query', '')
const filter = atom('filter', 'all', { persist: 'plugin' })

const RUNNING = new Set(['running', 'pending', 'started'])
const BAD = new Set(['failure', 'error', 'killed'])

function toneOf(status: string | null): Tone {
  if (!status) return 'neutral'
  if (status === 'success') return 'success'
  if (BAD.has(status)) return 'danger'
  if (RUNNING.has(status) || status === 'blocked') return 'warning'
  return 'neutral'
}

const DOT: Record<Tone, string> = {
  success: '🟢',
  danger: '🔴',
  warning: '🟡',
  accent: '🔵',
  neutral: '⚪'
}

const LABEL: Record<string, Key> = {
  success: 'sSuccess',
  failure: 'sFailure',
  error: 'sError',
  killed: 'sKilled',
  running: 'sRunning',
  pending: 'sPending',
  started: 'sRunning',
  blocked: 'sBlocked',
  declined: 'sDeclined',
  skipped: 'sSkipped'
}

const statusText = (status: string): string => (LABEL[status] ? tr(LABEL[status]) : status)

function ago(unix: number): string {
  if (!unix) return ''
  const s = Math.max(0, Math.round(Date.now() / 1000 - unix))
  if (s < 60) return tr('justNow')
  if (s < 3600) return tr('minAgo', { n: Math.round(s / 60) })
  if (s < 86400) return tr('hAgo', { n: Math.round(s / 3600) })
  return tr('dAgo', { n: Math.round(s / 86400) })
}

/** When the pipeline last changed: finish time, or start time while it is still running */
function stamp(r: RepoStatus): number {
  return r.finished || r.started
}

/** Newest change first, projects without any pipeline last */
function byRecency(a: RepoStatus, b: RepoStatus): number {
  return stamp(b) - stamp(a) || a.name.localeCompare(b.name)
}

/** Relative time for recent builds, a date for old ones */
function when(unix: number): string {
  if (!unix) return ''
  const days = (Date.now() / 1000 - unix) / 86400
  if (days < 7) return ago(unix)
  return new Date(unix * 1000).toLocaleDateString(read(lang), { day: 'numeric', month: 'short', year: days > 300 ? 'numeric' : undefined })
}

const FILTERS = ['all', 'failed', 'running', 'passed'] as const

function matchesFilter(r: RepoStatus, f: string): boolean {
  if (f === 'failed') return !!r.status && BAD.has(r.status)
  if (f === 'running') return !!r.status && RUNNING.has(r.status)
  if (f === 'passed') return r.status === 'success'
  return true
}

function matchesQuery(r: RepoStatus, q: string): boolean {
  if (!q) return true
  const hay = [r.name, r.branch, r.commit, r.message, r.number === null ? '' : `#${r.number}`].join(' ').toLowerCase()
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((word) => hay.includes(word))
}

/** Age group of a repo for the section headers */
function group(r: RepoStatus): string {
  const t = stamp(r)
  if (!t) return tr('gNone')
  const hours = (Date.now() / 1000 - t) / 3600
  if (hours < 24) return tr('gDay')
  if (hours < 24 * 7) return tr('gWeek')
  return tr('gOlder')
}

async function loadConfig(): Promise<void> {
  const cfg = await plugin.request('config.get')
  if (isLang(cfg.lang)) set(lang, cfg.lang)
  set(form, { url: cfg.url, token: '', hasToken: cfg.hasToken, edit: !cfg.url || !cfg.hasToken })
}

async function save(): Promise<void> {
  const f = read(form)
  if (!f) return
  set(saveError, '')
  if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$))/.test(f.url.trim())) {
    set(saveError, tr('urlRule'))
    return
  }
  if (!f.token.trim() && !f.hasToken) {
    set(saveError, tr('tokenMissing'))
    return
  }
  try {
    await plugin.request('config.save', { url: f.url, token: f.token })
    set(form, { ...f, token: '', hasToken: true, edit: false })
    set(details, {})
  } catch (err) {
    set(saveError, errorText(read(lang), err instanceof Error ? err.message : String(err)))
  }
}

async function refresh(): Promise<void> {
  set(refreshing, true)
  try {
    set(ci, await plugin.request('status.refresh'))
  } finally {
    set(refreshing, false)
  }
}

async function loadDetail(r: RepoStatus): Promise<void> {
  if (r.number === null) return
  const key = `${r.id}#${r.number}`
  if (read(details)[key]) return
  set(details, { ...read(details), [key]: 'loading' })
  try {
    const d = await plugin.request('detail.get', { repoId: r.id, number: r.number })
    set(details, { ...read(details), [key]: d })
  } catch {
    set(details, { ...read(details), [key]: 'error' })
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('status.changed', (s) => set(ci, s)))
  void loadConfig()
  void plugin.request('status.get').then((s) => set(ci, s))
}

function Setup() {
  const f = read(form)
  const err = read(saveError)
  if (!f) return <Skeleton lines={3} label={tr('loading')} />
  return (
    <Stack gap="md">
      <Heading level={3}>{tr('connect')}</Heading>
      <Select
        label={tr('language')}
        value={read(lang)}
        options={[
          { value: 'en', label: 'English' },
          { value: 'de', label: 'Deutsch' }
        ]}
        onChange={(v) => {
          if (!isLang(v)) return
          set(lang, v)
          void plugin.request('lang.set', { lang: v })
        }}
      />
      <Input
        label={tr('serverUrl')}
        placeholder="https://ci.example.de"
        value={f.url}
        onChange={(url) => set(form, { ...f, url })}
      />
      <Input
        label={tr('token')}
        type="password"
        placeholder={f.hasToken ? tr('tokenSaved') : tr('tokenPaste')}
        value={f.token}
        onChange={(token) => set(form, { ...f, token })}
        onSubmit={save}
      />
      <Text muted size="xs">
        {tr('tokenHelp')}
      </Text>
      {err ? <Callout tone="danger" title={tr('errorTitle')}>{err}</Callout> : null}
      <Row gap="xs">
        <Button onPress={save}>{tr('save')}</Button>
        {f.hasToken ? (
          <Button variant="ghost" onPress={() => set(form, { ...f, edit: false })}>
            {tr('cancel')}
          </Button>
        ) : null}
      </Row>
    </Stack>
  )
}

function DetailView({ r }: { r: RepoStatus }) {
  const d = read(details)[`${r.id}#${r.number}`]
  if (!d || d === 'loading') return <Skeleton lines={3} label={tr('loadingDetails')} />
  if (d === 'error') return <Text tone="danger">{tr('detailError')}</Text>
  return (
    <Stack gap="sm">
      {d.errors.map((e, i) => (
        <Callout key={i} tone="danger" title={tr('errorTitle')}>
          {e}
        </Callout>
      ))}
      {d.steps.map((s, i) => (
        <Row key={i} gap="xs" justify="between">
          <Text size="xs" truncate>
            {s.workflow} / {s.name}
          </Text>
          <Badge tone={toneOf(s.state)}>{statusText(s.state)}</Badge>
        </Row>
      ))}
      {d.steps.some((s) => s.error) ? (
        <Text tone="danger" size="xs">
          {d.steps.filter((s) => s.error).map((s) => `${s.name}: ${s.error}`).join('\n')}
        </Text>
      ) : null}
      {d.log ? (
        <Stack gap="xs">
          <Text size="xs" weight="semibold">
            {tr('logOf', { step: d.logStep })}
          </Text>
          <Box scroll="both" maxHeight={240}>
            <Code block>{d.log}</Code>
          </Box>
        </Stack>
      ) : null}
      <Link href={r.webUrl}>{tr('openIn')}</Link>
    </Stack>
  )
}

function RepoRow({ r }: { r: RepoStatus }) {
  const label = r.status ? statusText(r.status) : tr('noPipeline')
  // Build state at a glance: status, build number, commit, branch and age
  const build = [
    label,
    r.number !== null ? `#${r.number}` : '',
    r.commit,
    r.branch,
    when(stamp(r))
  ].filter(Boolean)
  return (
    <Collapsible
      title={`${DOT[toneOf(r.status)]} ${r.name}`}
      description={build.join(' · ')}
      onChange={(open) => open && void loadDetail(r)}
    >
      <Stack gap="sm">
        {r.message ? <Text size="xs">{r.message}</Text> : null}
        {r.number === null ? <Text muted>{tr('noRunYet')}</Text> : <DetailView r={r} />}
      </Stack>
    </Collapsible>
  )
}

export default function Panel() {
  const f = read(form)
  const s = read(ci)
  if (!f) return <Skeleton lines={4} label={tr('loading')} />
  if (f.edit || (s && !s.configured)) return <Setup />
  if (!s) return <Skeleton lines={4} label={tr('loading')} />

  const all = [...s.repos].sort(byRecency)
  const failedRepos = all.filter((r) => matchesFilter(r, 'failed'))
  const bad = failedRepos.length
  const run = all.filter((r) => matchesFilter(r, 'running')).length
  const passed = all.filter((r) => matchesFilter(r, 'passed')).length
  const q = read(query).trim()
  const active = FILTERS.includes(read(filter) as (typeof FILTERS)[number]) ? read(filter) : 'all'
  const repos = all.filter((r) => matchesFilter(r, active) && matchesQuery(r, q))
  const counts: Record<string, number> = { all: all.length, failed: bad, running: run, passed }
  const names: Record<string, string> = { all: tr('fAll'), failed: tr('fFailed'), running: tr('fRunning'), passed: tr('fPassed') }
  return (
    <Stack gap="md">
      <Row justify="between">
        <Row gap="xs">
          <Heading level={3}>{tr('title')}</Heading>
          <Badge tone={bad ? 'danger' : 'success'}>{bad ? tr('nFailed', { n: bad }) : tr('allGreen')}</Badge>
          {run ? <Badge tone="warning">{tr('nRunning', { n: run })}</Badge> : null}
        </Row>
        <Row gap="xs">
          <IconButton icon="refresh" label={tr('refresh')} disabled={read(refreshing)} onPress={refresh} />
          <IconButton icon="settings" label={tr('settings')} onPress={() => set(form, { ...f, edit: true })} />
        </Row>
      </Row>
      {s.error ? <Callout tone="danger" title={tr('errorTitle')}>{errorText(read(lang), s.error)}</Callout> : null}
      {bad > 0 && active !== 'failed' ? (
        <Callout tone="danger" title={tr('failedTitle')}>
          {failedRepos.map((r) => `${r.name} #${r.number} (${ago(stamp(r))})`).join('\n')}
        </Callout>
      ) : null}
      <Row gap="xs">
        <Input label={tr('searchLabel')} labelHidden type="search" placeholder={tr('searchHint')} value={read(query)} onChange={(v) => set(query, v)} />
        <Select
          label={tr('statusLabel')}
          labelHidden
          value={active}
          options={FILTERS.map((f) => ({ value: f, label: `${names[f]} (${counts[f]})` }))}
          onChange={(v) => set(filter, v)}
        />
      </Row>
      {repos.length === 0 ? <Text muted>{tr('noMatch')}</Text> : null}
      {repos.map((r, i) => (
        <Stack key={r.id} gap="xs">
          {i === 0 || group(repos[i - 1]) !== group(r) ? (
            <Text muted size="xs" weight="semibold">
              {group(r)}
            </Text>
          ) : null}
          <RepoRow r={r} />
        </Stack>
      ))}
      <Text muted size="xs">
        {tr('updated', { time: new Date(s.updatedAt).toLocaleTimeString(read(lang)) })} ·{' '}
        {repos.length === all.length ? tr('nProjects', { n: all.length }) : tr('xOfY', { x: repos.length, y: all.length })}
      </Text>
    </Stack>
  )
}
