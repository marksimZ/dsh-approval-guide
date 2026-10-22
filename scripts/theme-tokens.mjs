/**
 * Theme-token guard for the approval guide.
 *
 * Usage: node scripts/theme-tokens.mjs [--asar <path to app.asar>]
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(resolve(HERE, '..'), 'src', 'client.js')

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined
}

const KNOWN_INVALID = [
  '--dsw-alias-bg-elevated',
  '--dsw-alias-text-primary',
  '--dsw-alias-text-secondary',
  '--dsw-alias-border-subtle',
]

const VERIFIED = new Set([
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-border-l2',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-link',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-font-family',
  '--dsw-radius-md',
  '--dsw-radius-sm',
])

const ASAR = option('asar') ?? process.env.DSH_ASAR ?? 'E:\\dsh\\resources\\app.asar'

async function installedStylesheet() {
  const registrations = []
  globalThis.window = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
  globalThis.document = {
    hidden: false,
    head: { appendChild: () => {} },
    createElement: () => ({ dataset: {}, textContent: '' }),
    querySelector: () => null,
  }
  await import(`${pathToFileURL(BUNDLE).href}?t=${Date.now()}`)
  const module = registrations[0].factory(() => ({
    createElement: () => ({}),
    Fragment: 'fragment',
    useState: () => [null, () => {}],
    useEffect: () => {},
    useRef: value => ({ current: value }),
  }))
  const tags = []
  globalThis.document.head.appendChild = tag => { tags.push(tag) }
  module.apply({
    effect: body => { body(); return () => {} },
    slots: { inject: () => () => {}, register: () => () => {} },
    logger: { warn: () => {}, error: () => {} },
  })
  if (tags.length !== 1) throw new Error(`expected one stylesheet, captured ${tags.length}`)
  return tags[0].textContent
}

function declaredTokens() {
  if (!existsSync(ASAR)) return new Set()
  const size = statSync(ASAR).size
  if (size > 900 * 1024 * 1024) return new Set()
  const text = readFileSync(ASAR, 'utf8')
  const names = new Set()
  for (const match of text.matchAll(/(--dsw-[a-z0-9-]+)\s*:/g)) names.add(match[1])
  console.log(`[tokens] theme source: ${ASAR} (${names.size} declared properties)`)
  return names
}

const css = await installedStylesheet()
const referenced = [...new Set([...css.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)].map(match => match[1]))].sort()
const declared = declaredTokens()
console.log(`[tokens] stylesheet references ${referenced.length} custom properties`)
if (referenced.length === 0) throw new Error('stylesheet references no custom properties')

const problems = []
for (const token of referenced) {
  if (KNOWN_INVALID.includes(token)) {
    problems.push(`${token} (known-invalid theme token)`)
    continue
  }
  if (declared.size === 0) {
    if (!VERIFIED.has(token)) problems.push(`${token} (not in the verified allowlist)`)
    continue
  }
  if (!declared.has(token)) problems.push(`${token} (not declared by the shipped theme)`)
}

if (problems.length > 0) {
  console.error(`\n[tokens] ${problems.length} unresolved theme reference(s):`)
  for (const problem of problems) console.error('  -', problem)
  process.exit(1)
}

for (const selector of ['.dug-root', '.dug-detail', '.dug-toggle', '.dug-dot']) {
  if (!css.includes(selector)) throw new Error(`stylesheet lost ${selector}`)
}
if (!css.includes("data-level='high'")) throw new Error('stylesheet lost the high-risk state')
if (!css.includes("data-level='medium'")) throw new Error('stylesheet lost the medium-risk state')
if (!css.includes('prefers-reduced-motion')) throw new Error('stylesheet lost the reduced-motion guard')

console.log('[tokens] every reference resolves')
console.log('[tokens] OK')
