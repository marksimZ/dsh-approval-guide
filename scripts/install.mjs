/**
 * Install the approval guide into a DSH profile's own patch layer.
 *
 * Usage: node scripts/install.mjs [--home <DSH_HOME>] [--profile desktop|web] [--host <file-url>] [--dry-run]
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = resolve(HERE, '..')

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined
}

const flag = name => process.argv.includes(`--${name}`)

function pathToFileURLOf(absolute) {
  const posix = absolute.replaceAll('\\', '/')
  return `file:///${posix.replace(/^\/+/, '')}`
}

const home = option('home') ?? process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? homedir(), '.dsh')
const profilesDir = join(home, 'profiles')

function defaultProfile() {
  if (existsSync(join(profilesDir, 'desktop'))) return 'desktop'
  if (existsSync(join(profilesDir, 'web'))) return 'web'
  return 'web'
}

const profile = option('profile') ?? defaultProfile()
const patchPath = join(profilesDir, profile, 'cordis.patch.yml')
const hostEntry = option('host') ?? pathToFileURLOf(join(PACKAGE_DIR, 'src', 'index.ts'))

if (!existsSync(join(profilesDir, profile))) {
  console.error(`[install] no profile at ${join(profilesDir, profile)}`)
  console.error('[install] pass --home <DSH_HOME> or start the client once to create the profile')
  process.exit(1)
}

const existing = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : '# Your patch layer for this dsh profile.\n[]\n'

if (/^\s*-?\s*id:\s*approval-guide\s*$/m.test(existing) || existing.includes('dsh-approval-guide/src/index.ts')) {
  console.log(`[install] approval-guide is already present in ${patchPath}`)
  process.exit(0)
}

function merged(text) {
  const block = [
    '',
    '# dsh-approval-guide: plain-language risk explanation while an approval is pending.',
    '- insert:',
    '    - id: approval-guide',
    `      name: '${hostEntry}'`,
    '      config:',
    '        widgets:',
    '          explainer: true',
    '        minLevel: medium',
    '        showLow: false',
    '        previewChars: 400',
    '        extraHighRisk: []',
    '',
  ].join('\n')
  const stripped = text.replace(/^\s*\[\s*\]\s*$/m, '')
  return `${stripped.replace(/\s*$/, '')}\n${block}`
}

const next = merged(existing)

if (flag('dry-run')) {
  console.log(`[install] would write ${patchPath}:\n`)
  console.log(next)
  process.exit(0)
}

writeFileSync(patchPath, next)
console.log(`[install] wrote ${patchPath}`)
console.log(`[install] profile: ${profile}`)
console.log(`[install] host half: ${hostEntry}`)
console.log('[install] the profile reloads this file live — reload the page to see the widget.')
