/**
 * Host smoke — mount `apply` on a mock Host context, drive the approval
 * lifecycle through the real route, and prove the digest stays sanitized.
 *
 * Usage: node --experimental-strip-types scripts/host-smoke.mjs
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENTRY = join(resolve(HERE, '..'), 'src', 'index.ts')

let checks = 0
const failures = []

function check(label, actual, expected) {
  checks += 1
  if (!Object.is(actual, expected) && JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assert(label, condition) {
  checks += 1
  if (!condition) failures.push(`${label}: condition failed`)
}

const sleep = milliseconds => new Promise(settle => setTimeout(settle, milliseconds))

function mockContext(services) {
  const routes = []
  const listeners = new Map()
  return {
    routes,
    ...services,
    effect(body) {
      const dispose = body()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    logger: { warn: () => {} },
  }
}

function respond(handler, method = 'GET', url = '/dsh-approval-guide/pending') {
  return new Promise((settle, fail) => {
    const res = {
      status: 0,
      writeHead(status) { this.status = status },
      end(body) { settle({ status: this.status, body: body ?? '' }) },
    }
    try { handler({ method, url }, res) } catch (error) { fail(error) }
  })
}

const session = { id: 'session-1', header: {}, projections: { workingDirectory: 'D:/proj' } }
const projections = {
  stateOf(target, key) {
    return target?.projections?.[key]
  },
}

const module = await import(pathToFileURL(ENTRY).href)
check('module name', module.name, 'approval-guide')
check('injection global', module.CONFIG_GLOBAL, '__DSH_APPROVAL_GUIDE_CONFIG__')
check('declares its services', module.inject.join(','), 'webServer,sessionProjections')

const ctx = mockContext({ sessionProjections: projections })
module.apply(ctx, { minLevel: 'high', showLow: true, previewChars: 200, extraHighRisk: ['frobnicate'] })
check('one route', ctx.routes.length, 1)
check('route path', ctx.routes[0].path, '/dsh-approval-guide/pending')

// Widget switches and user rules reach the browser.
const table = []
ctx.emit('webserver/index-inject', table)
check('one injection row', table.length, 1)
check('injection minLevel', table[0].value.minLevel, 'high')
check('injection showLow', table[0].value.showLow, true)
check('injection custom rules', table[0].value.extraHighRisk, ['frobnicate'])

// --- a pending approval with a payload argument ------------------------
const payload = 'x'.repeat(500)
ctx.emit('session/event', session, {
  type: 'tool/call',
  data: { turn: 1, step: 1, callId: 'c1', name: 'write', arguments: JSON.stringify({ path: 'src/a.ts', content: payload }) },
})
ctx.emit('session/event', session, {
  type: 'approval/asked',
  data: { id: 'r1', toolName: 'write', callId: 'c1', reason: 'edit the balance policy' },
})
const first = JSON.parse((await respond(ctx.routes[0].handler, 'GET', '/dsh-approval-guide/pending?session=session-1')).body)
check('one pending', first.pending.length, 1)
const pending = first.pending[0]
check('request id', pending.requestId, 'r1')
check('tool name', pending.digest.toolName, 'write')
check('path extracted', pending.digest.path, 'src/a.ts')
check('cwd attached', pending.digest.cwd, 'D:/proj')
check('reason forwarded', pending.reason, 'edit the balance policy')
assert('preview replaces the payload', pending.digest.preview.includes('<500 chars>'))
assert('preview omits the payload bytes', !pending.digest.preview.includes('xxxxx'))
assert('preview is bounded', pending.digest.preview.length <= 201)

// --- decided removes it -------------------------------------------------
ctx.emit('session/event', session, { type: 'approval/decided', data: { id: 'r1', outcome: { kind: 'allow' } } })
const afterDecide = JSON.parse((await respond(ctx.routes[0].handler, 'GET', '/dsh-approval-guide/pending?session=session-1')).body)
check('decided clears the pending', afterDecide.pending.length, 0)

// --- asked before its call: the digest is refreshed later --------------
ctx.emit('session/event', session, { type: 'approval/asked', data: { id: 'r2', toolName: 'bash', callId: 'c2' } })
const early = JSON.parse((await respond(ctx.routes[0].handler, 'GET', '/dsh-approval-guide/pending?session=session-1')).body)
assert('early pending has an empty command', early.pending[0].digest.command === undefined)
ctx.emit('session/event', session, {
  type: 'tool/call',
  data: { turn: 1, step: 2, callId: 'c2', name: 'bash', arguments: JSON.stringify({ command: 'rm -rf build' }) },
})
const late = JSON.parse((await respond(ctx.routes[0].handler, 'GET', '/dsh-approval-guide/pending?session=session-1')).body)
check('late digest picks up the command', late.pending[0].digest.command, 'rm -rf build')

// --- ordering by request time ------------------------------------------
await sleep(2)
ctx.emit('session/event', session, {
  type: 'tool/call',
  data: { turn: 1, step: 3, callId: 'c3', name: 'bash', arguments: JSON.stringify({ command: 'ls -la' }) },
})
ctx.emit('session/event', session, { type: 'approval/asked', data: { id: 'r3', toolName: 'bash', callId: 'c3' } })
const ordered = JSON.parse((await respond(ctx.routes[0].handler, 'GET', '/dsh-approval-guide/pending?session=session-1')).body)
check('pending sorted by request time', ordered.pending.map(entry => entry.requestId), ['r2', 'r3'])

// --- edges --------------------------------------------------------------
const unknown = JSON.parse((await respond(ctx.routes[0].handler, 'GET', '/dsh-approval-guide/pending?session=nope')).body)
check('unknown session returns no pending', unknown.pending.length, 0)
const post = await respond(ctx.routes[0].handler, 'POST')
check('POST is refused', post.status, 405)
const head = await respond(ctx.routes[0].handler, 'HEAD')
check('HEAD is accepted', head.status, 200)
check('HEAD has no body', head.body, '')

// The wire payload carries no file contents or prompts.
for (const forbidden of ['xxxxxxxx', '"content"', 'prompt"']) {
  assert(`wire payload omits ${forbidden}`, !JSON.stringify(first).includes(forbidden))
}

if (failures.length > 0) {
  console.error(`\n[host-smoke] ${failures.length} of ${checks} checks failed:`)
  for (const failure of failures) console.error('  -', failure)
  process.exit(1)
}
console.log(`[host-smoke] ${checks} checks passed`)
process.exit(0)
