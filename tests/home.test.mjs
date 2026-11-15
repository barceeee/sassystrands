// Role home routing and path allow-list. Run: npm test
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homeFor, allowedPath } from '../src/lib/home.js'

test('stationHome: STATION lands on the scanner and nothing else', () => {
  assert.equal(homeFor('STATION'), '/station')
  assert.equal(allowedPath('STATION', '/users'), false)
  assert.equal(allowedPath('STATION', '/station'), true)
  assert.equal(allowedPath('STATION', '/'), false)
  assert.equal(allowedPath('STATION', '/station/overview'), false)
  assert.equal(allowedPath('STATION', '/production'), false)
})

test('LEADER lands on the overview and may use scanner, account and progress pages', () => {
  assert.equal(homeFor('LEADER'), '/station/overview')
  assert.equal(allowedPath('LEADER', '/station/overview'), true)
  assert.equal(allowedPath('LEADER', '/station'), true)
  assert.equal(allowedPath('LEADER', '/account'), true)
  assert.equal(allowedPath('LEADER', '/production'), true)
  assert.equal(allowedPath('LEADER', '/pieces/SS-000001'), true)
  assert.equal(allowedPath('LEADER', '/labels'), true)
  assert.equal(allowedPath('LEADER', '/receiving'), false)
  assert.equal(allowedPath('LEADER', '/users'), false)
  assert.equal(allowedPath('LEADER', '/'), false)
  assert.equal(allowedPath('LEADER', '/productionx'), false)
})

test('other roles go to the dashboard and cannot open station screens', () => {
  assert.equal(homeFor('INVENTORY'), '/')
  assert.equal(homeFor('OWNER'), '/')
  assert.equal(allowedPath('INVENTORY', '/inventory'), true)
  assert.equal(allowedPath('INVENTORY', '/station'), false)
  assert.equal(allowedPath('ADMIN', '/station/overview'), false)
})
