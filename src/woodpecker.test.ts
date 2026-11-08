import { assert, test } from 'orca/testing'
import { normalizeUrl } from './woodpecker'

test('normalizeUrl trims spaces and trailing slashes', () => {
  assert.equal(normalizeUrl(' https://ci.example.de/// '), 'https://ci.example.de')
  assert.equal(normalizeUrl('https://ci.example.de'), 'https://ci.example.de')
})
