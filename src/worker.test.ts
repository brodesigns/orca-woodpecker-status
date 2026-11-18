import { assert, test } from 'orca/testing'
import { evaluateChange, nextInterval, type Seen } from './worker'

test('nextInterval backs off 30 s, 60 s, 120 s after errors and resets on success', () => {
  assert.equal(nextInterval(0, false), 30_000)
  assert.equal(nextInterval(0, true), 10_000)
  assert.equal(nextInterval(1, true), 30_000)
  assert.equal(nextInterval(2, false), 60_000)
  assert.equal(nextInterval(3, false), 120_000)
  assert.equal(nextInterval(10, false), 120_000)
})

/** Runs a sequence of polls for one repo and returns the notifications */
function run(states: [number | null, string | null][]): string[] {
  let seen: Seen | undefined
  const out: string[] = []
  for (const [number, status] of states) {
    const { next, change } = evaluateChange(seen, { number, status })
    seen = next
    if (change) out.push(`${number}:${change}`)
  }
  return out
}

test('the first state of a repo never notifies', () => {
  assert.deepEqual(run([[5, 'failure']]), [])
  assert.deepEqual(run([[5, 'failure'], [5, 'failure']]), [])
})

test('a new failed pipeline notifies once', () => {
  assert.deepEqual(run([[4, 'success'], [5, 'running'], [5, 'failure'], [5, 'failure']]), ['5:failed'])
})

test('green after red notifies recovered, also with a running pipeline in between', () => {
  assert.deepEqual(run([[5, 'failure'], [6, 'running'], [6, 'success']]), ['6:recovered'])
  assert.deepEqual(run([[5, 'success'], [6, 'success']]), [])
})

test('a repo that gets its first pipeline notifies when it fails', () => {
  assert.deepEqual(run([[null, null], [1, 'failure']]), ['1:failed'])
})
