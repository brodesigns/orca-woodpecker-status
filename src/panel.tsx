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
  set,
  Skeleton,
  Stack,
  Text,
  type PanelContext,
  type Tone
} from 'orca'
import type { CiState, Detail, RepoStatus } from './protocol'

const ci = atom<CiState | null>(null)
const form = atom<{ url: string; token: string; hasToken: boolean; edit: boolean } | null>(null)
const details = atom<Record<string, Detail | 'loading' | 'error'>>({})
const refreshing = atom(false)
const saveError = atom('')

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

const LABEL: Record<string, string> = {
  success: 'passed',
  failure: 'failed',
  error: 'error',
  killed: 'killed',
  running: 'running',
  pending: 'pending',
  started: 'running',
  blocked: 'blocked',
  declined: 'declined',
  skipped: 'skipped'
}

/** Failed first, then running, then the rest by name */
function rank(r: RepoStatus): number {
  if (r.status && BAD.has(r.status)) return 0
  if (r.status && RUNNING.has(r.status)) return 1
  return r.status ? 2 : 3
}

function ago(unix: number): string {
  if (!unix) return ''
  const s = Math.max(0, Math.round(Date.now() / 1000 - unix))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} d ago`
}

async function loadConfig(): Promise<void> {
  const cfg = await plugin.request('config.get')
  set(form, { url: cfg.url, token: '', hasToken: cfg.hasToken, edit: !cfg.url || !cfg.hasToken })
}

async function save(): Promise<void> {
  const f = read(form)
  if (!f) return
  set(saveError, '')
  if (!/^(https:\/\/|http:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$))/.test(f.url.trim())) {
    set(saveError, 'URL must start with https:// (http:// only for localhost)')
    return
  }
  if (!f.token.trim() && !f.hasToken) {
    set(saveError, 'Token missing')
    return
  }
  try {
    await plugin.request('config.save', { url: f.url, token: f.token })
    set(form, { ...f, token: '', hasToken: true, edit: false })
    set(details, {})
  } catch (err) {
    set(saveError, String(err))
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
  if (!f) return <Skeleton lines={3} label="Loading" />
  return (
    <Stack gap="md">
      <Heading level={3}>Connect Woodpecker</Heading>
      <Input
        label="Server URL"
        placeholder="https://ci.example.de"
        value={f.url}
        onChange={(url) => set(form, { ...f, url })}
      />
      <Input
        label="Personal Access Token"
        type="password"
        placeholder={f.hasToken ? 'saved, leave empty to keep it' : 'Paste token'}
        value={f.token}
        onChange={(token) => set(form, { ...f, token })}
        onSubmit={save}
      />
      <Text muted size="xs">
        Get a token in Woodpecker: profile (top right), User settings, Personal Access Token.
        It is stored encrypted in Orca.
      </Text>
      {err ? <Callout tone="danger">{err}</Callout> : null}
      <Row gap="xs">
        <Button onPress={save}>Save</Button>
        {f.hasToken ? (
          <Button variant="ghost" onPress={() => set(form, { ...f, edit: false })}>
            Cancel
          </Button>
        ) : null}
      </Row>
    </Stack>
  )
}

function DetailView({ r }: { r: RepoStatus }) {
  const d = read(details)[`${r.id}#${r.number}`]
  if (!d || d === 'loading') return <Skeleton lines={3} label="Loading details" />
  if (d === 'error') return <Text tone="danger">Could not load details</Text>
  return (
    <Stack gap="sm">
      {d.errors.map((e, i) => (
        <Callout key={i} tone="danger">
          {e}
        </Callout>
      ))}
      {d.steps.map((s, i) => (
        <Row key={i} gap="xs" justify="between">
          <Text size="xs" truncate>
            {s.workflow} / {s.name}
          </Text>
          <Badge tone={toneOf(s.state)}>{LABEL[s.state] ?? s.state}</Badge>
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
            Log of “{d.logStep}” (last lines)
          </Text>
          <Box scroll="both" maxHeight={240}>
            <Code block>{d.log}</Code>
          </Box>
        </Stack>
      ) : null}
      <Link href={r.webUrl}>Open in Woodpecker</Link>
    </Stack>
  )
}

function RepoRow({ r }: { r: RepoStatus }) {
  const label = r.status ? (LABEL[r.status] ?? r.status) : 'no pipeline'
  const meta = [r.branch, ago(r.finished || r.started)].filter(Boolean).join(' · ')
  return (
    <Collapsible
      title={`${DOT[toneOf(r.status)]} ${r.name}`}
      description={[label, meta].filter(Boolean).join(' · ')}
      onChange={(open) => open && void loadDetail(r)}
    >
      <Stack gap="sm">
        {r.message ? <Text size="xs">{r.message}</Text> : null}
        {r.number === null ? <Text muted>No pipeline has run yet.</Text> : <DetailView r={r} />}
      </Stack>
    </Collapsible>
  )
}

export default function Panel() {
  const f = read(form)
  const s = read(ci)
  if (!f) return <Skeleton lines={4} label="Loading" />
  if (f.edit || (s && !s.configured)) return <Setup />
  if (!s) return <Skeleton lines={4} label="Loading" />

  const repos = [...s.repos].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
  const bad = repos.filter((r) => r.status && BAD.has(r.status)).length
  const run = repos.filter((r) => r.status && RUNNING.has(r.status)).length
  return (
    <Stack gap="md">
      <Row justify="between">
        <Row gap="xs">
          <Heading level={3}>CI</Heading>
          <Badge tone={bad ? 'danger' : 'success'}>{bad ? `${bad} failed` : 'all green'}</Badge>
          {run ? <Badge tone="warning">{run} running</Badge> : null}
        </Row>
        <Row gap="xs">
          <IconButton icon="refresh" label="Refresh" disabled={read(refreshing)} onPress={refresh} />
          <IconButton icon="settings" label="Settings" onPress={() => set(form, { ...f, edit: true })} />
        </Row>
      </Row>
      {s.error ? <Callout tone="danger">{s.error}</Callout> : null}
      {repos.map((r) => (
        <RepoRow key={r.id} r={r} />
      ))}
      <Text muted size="xs">
        Updated {new Date(s.updatedAt).toLocaleTimeString()} · {repos.length} projects
      </Text>
    </Stack>
  )
}
