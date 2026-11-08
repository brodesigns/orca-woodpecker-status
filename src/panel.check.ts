// Scenarios for `orca plugin check` and `orca plugin shot --scenario`, with demo data only
import { defineCheck } from 'orca/testing'
import type { CiState, Detail, RepoStatus } from './protocol'

const now = Math.floor(Date.now() / 1000)
const BASE = 'https://ci.example.com'

function repo(id: number, name: string, status: string | null, minutesAgo: number, message: string): RepoStatus {
  return {
    id,
    name,
    status,
    number: status ? id * 10 : null,
    branch: 'main',
    message,
    event: 'push',
    started: now - minutesAgo * 60 - 90,
    finished: status === 'running' ? 0 : now - minutesAgo * 60,
    webUrl: `${BASE}/repos/${id}/pipeline/${id * 10}`
  }
}

const state: CiState = {
  configured: true,
  error: null,
  updatedAt: Date.now(),
  repos: [
    repo(1, 'acme/web-shop', 'failure', 12, 'Update checkout flow'),
    repo(2, 'acme/api', 'running', 1, 'Add rate limiting'),
    repo(3, 'acme/docs', 'success', 45, 'Fix typos in the setup guide'),
    repo(4, 'acme/mobile-app', 'success', 180, 'Bump dependencies'),
    repo(5, 'acme/landing-page', 'success', 1500, 'New hero section'),
    repo(6, 'acme/infra', 'success', 4300, 'Rotate deploy keys'),
    repo(7, 'acme/design-system', null, 0, '')
  ]
}

const detail: Detail = {
  errors: [],
  steps: [
    { workflow: 'build', name: 'clone', state: 'success', exitCode: 0, error: '' },
    { workflow: 'build', name: 'install', state: 'success', exitCode: 0, error: '' },
    { workflow: 'build', name: 'test', state: 'failure', exitCode: 1, error: '' },
    { workflow: 'build', name: 'deploy', state: 'skipped', exitCode: 0, error: '' }
  ],
  logStep: 'test',
  log: [
    ' FAIL  tests/checkout.test.ts',
    '  ● checkout › applies the discount code',
    '    expected 4200 but received 4900',
    '',
    'Tests: 1 failed, 41 passed, 42 total'
  ].join('\n')
}

const requests = {
  'config.get': { url: BASE, hasToken: true },
  'status.get': state,
  'status.refresh': state,
  'detail.get': detail
}

export default defineCheck({
  overview: { requests, theme: 'dark' },
  setup: {
    requests: { ...requests, 'config.get': { url: '', hasToken: false }, 'status.get': { ...state, configured: false, repos: [] } },
    theme: 'dark'
  }
})
