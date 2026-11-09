import { assert, test } from 'orca/testing'
import { checkServerUrl, fetchRepos, isValidToken, normalizeUrl } from './woodpecker'

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
  let calls = 0
  const original = globalThis.fetch
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    calls++
    assert.equal(init?.redirect, 'manual')
    return new Response(null, { status: 302, headers: { location: 'https://evil.example/' } })
  }) as typeof fetch
  try {
    await assert.rejects(fetchRepos({ url: 'https://ci.example.com', token: 'secret' }), /redirects/)
    assert.equal(calls, 1)
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
