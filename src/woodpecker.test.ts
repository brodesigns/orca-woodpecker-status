import { assert, test } from 'orca/testing'
import type { RepoStatus } from './protocol'
import { checkServerUrl, fetchDetail, fetchRepos, isValidToken, logExcerpt, normalizeUrl, stripAnsi } from './woodpecker'

test('normalizeUrl trims spaces and trailing slashes', () => {
  assert.equal(normalizeUrl(' https://ci.example.de/// '), 'https://ci.example.de')
  assert.equal(normalizeUrl('https://ci.example.de'), 'https://ci.example.de')
})

test('checkServerUrl allows https and http only for localhost', () => {
  assert.equal(checkServerUrl('https://ci.example.com'), null)
  assert.equal(checkServerUrl('http://localhost:8000'), null)
  assert.equal(checkServerUrl('http://127.0.0.1:8000'), null)
  assert.ok(checkServerUrl('http://ci.example.com'))
  assert.ok(checkServerUrl('ftp://ci.example.com'))
  assert.ok(checkServerUrl('not a url'))
})

test('the token is never sent to a plain http server', async () => {
  let called = false
  const original = globalThis.fetch
  globalThis.fetch = (async () => {
    called = true
    return new Response('[]')
  }) as typeof fetch
  try {
    await assert.rejects(fetchRepos({ url: 'http://ci.example.com', token: 'secret' }))
    assert.equal(called, false)
  } finally {
    globalThis.fetch = original
  }
})

test('redirects are not followed', async () => {
  const urls: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    urls.push(String(url))
    assert.equal(init?.redirect, 'manual')
    return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })
  }) as typeof fetch
  try {
    await assert.rejects(fetchRepos({ url: 'https://ci.example.com', token: 'secret' }), /redirects/)
    // /user/repos and /user/feed, both only to the configured server
    assert.ok(urls.length > 0 && urls.every((u) => u.startsWith('https://ci.example.com/api/')))
  } finally {
    globalThis.fetch = original
  }
})

test('oversized responses are refused', async () => {
  const original = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response('x'.repeat(10), { headers: { 'content-length': String(50 * 1024 * 1024) } })) as typeof fetch
  try {
    await assert.rejects(fetchRepos({ url: 'https://ci.example.com', token: 'secret' }), /too large/)
  } finally {
    globalThis.fetch = original
  }
})

test('tokens with line breaks or spaces are refused', () => {
  assert.equal(isValidToken('abc.DEF-123_x'), true)
  assert.equal(isValidToken('abc\ndef'), false)
  assert.equal(isValidToken('abc def'), false)
  assert.equal(isValidToken(''), false)
})

/** Fake server: path (without /api) -> JSON body, or a status code for an error */
async function withServer<T>(routes: Record<string, unknown>, fn: (paths: string[]) => Promise<T>): Promise<T> {
  const paths: string[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (url: unknown) => {
    const path = String(url).replace('https://ci.example.com/api', '')
    paths.push(path)
    const body = routes[path]
    if (body === undefined) return new Response('not found', { status: 404 })
    if (typeof body === 'number') return new Response('', { status: body })
    return new Response(JSON.stringify(body))
  }) as typeof fetch
  try {
    return await fn(paths)
  } finally {
    globalThis.fetch = original
  }
}

const CONN = { url: 'https://ci.example.com', token: 'secret' }
const pipeline = (number: number, status: string, branch = 'main') => ({ number, status, branch, message: 'msg' })

test('a failed pipeline request keeps the last known status instead of null', async () => {
  const previous = [{ id: 1, name: 'a/b', status: 'failure', number: 5 } as RepoStatus]
  const res = await withServer({ '/user/repos': [{ id: 1, full_name: 'a/b' }], '/repos/1/pipelines?perPage=1': 500 }, () =>
    fetchRepos(CONN, { previous })
  )
  assert.deepEqual(res.failed, [1])
  assert.equal(res.repos[0].status, 'failure')
  assert.equal(res.repos[0].number, 5)
})

test('a repo without pipelines is not a failure', async () => {
  const res = await withServer({ '/user/repos': [{ id: 1, full_name: 'a/b' }], '/repos/1/pipelines?perPage=1': [] }, () =>
    fetchRepos(CONN)
  )
  assert.deepEqual(res.failed, [])
  assert.equal(res.repos[0].status, null)
})

test('inactive repos are skipped and the feed saves per-repo requests', async () => {
  await withServer(
    {
      '/user/repos': [
        { id: 1, full_name: 'a/one' },
        { id: 2, full_name: 'a/two', active: false },
        { id: 3, full_name: 'a/three' }
      ],
      '/user/feed?latest=true': [{ repo_id: 1, ...pipeline(7, 'success') }, { repo_id: 1, ...pipeline(6, 'failure') }],
      '/repos/3/pipelines?perPage=1': [pipeline(2, 'running')]
    },
    async (paths) => {
      const res = await fetchRepos(CONN)
      assert.deepEqual(
        res.repos.map((r) => [r.id, r.number, r.status]),
        [
          [1, 7, 'success'],
          [3, 2, 'running']
        ]
      )
      assert.ok(!paths.some((p) => p.startsWith('/repos/1/') || p.startsWith('/repos/2/')))
      assert.equal(res.truncated, false)
    }
  )
})

test('without a feed every repo is asked directly', async () => {
  const res = await withServer(
    { '/user/repos': [{ id: 1, full_name: 'a/one' }], '/repos/1/pipelines?perPage=1': [pipeline(3, 'success')] },
    () => fetchRepos(CONN)
  )
  assert.equal(res.repos[0].number, 3)
})

test('defaultBranchOnly ignores feed pipelines of other branches', async () => {
  const res = await withServer(
    {
      '/user/repos': [{ id: 1, full_name: 'a/one', default_branch: 'main' }],
      '/user/feed?latest=true': [{ repo_id: 1, ...pipeline(9, 'failure', 'feature') }],
      '/repos/1/pipelines?branch=main&perPage=10': [pipeline(9, 'failure', 'feature'), pipeline(8, 'success', 'main')]
    },
    () => fetchRepos(CONN, { defaultBranchOnly: true })
  )
  assert.equal(res.repos[0].number, 8)
  assert.equal(res.repos[0].branch, 'main')
})

test('stripAnsi removes colors, cursor codes and OSC links', () => {
  assert.equal(stripAnsi('\x1b[31mred\x1b[0m \x1b[1;32mgreen\x1b[K'), 'red green')
  assert.equal(stripAnsi('\x1b]8;;https://x\x07link\x1b]8;;\x07'), 'link')
})

test('logExcerpt decodes base64, strips ANSI and keeps the last lines', () => {
  const enc = (s: string) => ({ data: btoa(s) })
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n')
  const out = logExcerpt([enc('\x1b[31m'), enc(lines), enc('\nload 10%\rload 100%')])
  const rows = out.split('\n')
  assert.equal(rows.length, 30)
  assert.equal(rows.at(-1), 'load 100%')
  assert.ok(!out.includes('\x1b'))
})

test('fetchDetail returns the logs of all failed steps', async () => {
  const step = (id: number, name: string, state: string) => ({ id, name, state, exit_code: state === 'success' ? 0 : 1 })
  const detail = await withServer(
    {
      '/repos/1/pipelines/4': {
        ...pipeline(4, 'failure'),
        workflows: [{ name: 'ci', children: [step(10, 'lint', 'failure'), step(11, 'build', 'success'), step(12, 'test', 'failure')] }]
      },
      '/repos/1/logs/4/10': [{ data: btoa('lint error') }],
      '/repos/1/logs/4/12': [{ data: btoa('\x1b[31mtest error\x1b[0m') }]
    },
    () => fetchDetail(CONN, 1, 4)
  )
  assert.deepEqual(detail.logs, [
    { step: 'lint', text: 'lint error' },
    { step: 'test', text: 'test error' }
  ])
  assert.equal(detail.log, 'lint error')
  assert.equal(detail.logStep, 'lint')
})

test('more than 200 active repos are cut off and reported as truncated', async () => {
  const many = Array.from({ length: 205 }, (_, i) => ({ id: i + 1, full_name: `a/r${i + 1}` }))
  const feed = many.map((r) => ({ repo_id: r.id, ...pipeline(1, 'success') }))
  const res = await withServer({ '/user/repos': many, '/user/feed?latest=true': feed }, () => fetchRepos(CONN))
  assert.equal(res.repos.length, 200)
  assert.equal(res.truncated, true)
})
