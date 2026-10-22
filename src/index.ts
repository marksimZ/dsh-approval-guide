/**
 * Approval guide, Host half.
 *
 * One job: track the pending approvals of each session and publish a *sanitized
 * digest* of the tool call behind each one — tool name, command / path / URL,
 * the agent's reason, and a short argument preview with large payload fields
 * (file contents, patches, prompts) replaced by their size.
 *
 * The browser half classifies that digest with a conservative lexical rule
 * table and renders one explanatory line above the composer. The native
 * approval UI is never touched: `conversation.approval.detail` is a single seat
 * that shadows the shipped `ApprovalCommand`, so this plugin deliberately does
 * not register into it.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name (the Loader row name). */
export const name = 'approval-guide'

/** `webServer` carries the pending route; `sessionProjections` supplies the cwd. */
export const inject = ['webServer', 'sessionProjections']

/** Index-injection property carrying the display switches to the browser half. */
export const CONFIG_GLOBAL = '__DSH_APPROVAL_GUIDE_CONFIG__'

/** Pending-approval route. */
const ROUTE_PENDING = '/dsh-approval-guide/pending'

/** How many tool calls are remembered per session for digest lookup. */
const CALLS_KEPT = 200

/** How many pending approvals are published per session. */
const PENDING_KEPT = 50

/** Argument keys whose string value is a payload, not a description. */
const PAYLOAD_KEYS = ['content', 'text', 'patch', 'old_string', 'new_string', 'body', 'prompt', 'source', 'diff']

/** Host-half configuration. */
export interface Config {
  /** Per-widget switches (only the explainer exists today). @default { explainer: true } */
  readonly widgets?: { readonly explainer?: boolean }
  /** Maximum characters of the sanitized argument preview. @default 400 */
  readonly previewChars?: number
  /** Lowest level the browser shows: `high` | `medium` | `low`. @default 'medium' */
  readonly minLevel?: string
  /** Show a line for low-risk (read-only) approvals too. @default false */
  readonly showLow?: boolean
  /** Extra high-risk regular expressions supplied by the user. @default [] */
  readonly extraHighRisk?: readonly string[]
}

interface Settings {
  widgets: { explainer: boolean }
  previewChars: number
  minLevel: string
  showLow: boolean
  extraHighRisk: string[]
}

const DEFAULTS: Settings = {
  widgets: { explainer: true },
  previewChars: 400,
  minLevel: 'medium',
  showLow: false,
  extraHighRisk: [],
}

/* ------------------------------------------------------------------ types */

interface Digest {
  toolName: string
  command?: string
  path?: string
  url?: string
  cwd?: string
  preview: string
}

interface PendingEntry {
  requestId: string
  toolName: string
  callId?: string
  reason?: string
  since: number
  digest: Digest
}

interface CachedCall {
  toolName: string
  arguments: string
  at: number
}

interface SessionTrack {
  id: string
  session: unknown
  calls: Map<string, CachedCall>
  pending: Map<string, PendingEntry>
}

interface ProjectionRegistry {
  stateOf(session: unknown, key: string): unknown
}

interface RequestLike {
  method?: string
  url?: string
}

interface ResponseLike {
  writeHead(status: number, headers: Record<string, string>): void
  end(body?: string): void
}

/* --------------------------------------------------------------- helpers */

/** A declared service, read as a property (legal because of `inject`). */
function service<T>(ctx: Context, name: string): T | undefined {
  const direct = (ctx as unknown as Record<string, T | undefined>)[name]
  return direct === undefined ? undefined : direct
}

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The session id, wherever this DSH build put it. */
function sessionKey(session: unknown): string | undefined {
  const value = session as { id?: unknown; header?: { id?: unknown } } | null | undefined
  const id = value?.id ?? value?.header?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** Parse tool-call arguments, which are a JSON string on the wire. */
function parseArguments(raw: string): Record<string, unknown> | undefined {
  if (raw.length === 0) return undefined
  try {
    const value = JSON.parse(raw)
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : undefined
  } catch {
    return undefined
  }
}

/** First non-empty string among `keys`. */
function firstString(args: Record<string, unknown> | undefined, keys: readonly string[]): string | undefined {
  if (args === undefined) return undefined
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

/** Replace payload-shaped strings so file contents never leave the Host. */
function sanitizeArguments(args: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string' && PAYLOAD_KEYS.includes(key)) {
      safe[key] = '<' + String(value.length) + ' chars>'
      continue
    }
    if (typeof value === 'string' && value.length > 200) {
      safe[key] = value.slice(0, 200) + '…'
      continue
    }
    safe[key] = value
  }
  return safe
}

/** Build the display digest for one tool call. */
function digestOf(toolName: string, rawArguments: string, cwd: string | undefined, previewChars: number): Digest {
  const args = parseArguments(rawArguments)
  const previewSource = args === undefined ? rawArguments : JSON.stringify(sanitizeArguments(args))
  const preview = previewSource.length > previewChars ? previewSource.slice(0, previewChars) + '…' : previewSource
  const command = firstString(args, ['command', 'cmd', 'script', 'shell'])
  const path = firstString(args, ['path', 'file_path', 'filePath', 'filename', 'target'])
  const url = firstString(args, ['url', 'href', 'endpoint'])
  return {
    toolName,
    ...(command === undefined ? {} : { command }),
    ...(path === undefined ? {} : { path }),
    ...(url === undefined ? {} : { url }),
    ...(cwd === undefined || cwd.length === 0 ? {} : { cwd }),
    preview,
  }
}

/** Normalize a partial row config against the defaults. */
function normalize(config: Config | undefined): Settings {
  const widgets = config?.widgets ?? {}
  const previewChars = config?.previewChars
  const minLevel = text(config?.minLevel)
  return {
    widgets: { explainer: widgets.explainer ?? DEFAULTS.widgets.explainer },
    previewChars: Number.isFinite(previewChars) && Number(previewChars) > 0
      ? Math.round(Number(previewChars))
      : DEFAULTS.previewChars,
    minLevel: minLevel === 'high' || minLevel === 'medium' || minLevel === 'low' ? minLevel : DEFAULTS.minLevel,
    showLow: config?.showLow ?? DEFAULTS.showLow,
    extraHighRisk: Array.isArray(config?.extraHighRisk) ? config.extraHighRisk.filter(entry => typeof entry === 'string') : [],
  }
}

/* ------------------------------------------------------------------ apply */

/**
 * Mount the pending-approval tracker and its route.
 * @param ctx - Host plugin context.
 * @param config - optional row configuration.
 */
export function apply(ctx: Context, config?: Config): void {
  const settings = normalize(config)
  let disposed = false

  const projectionRegistry = (): ProjectionRegistry | undefined => service<ProjectionRegistry>(ctx, 'sessionProjections')

  const projectionOf = <T>(session: unknown, key: string): T | undefined => {
    const registry = projectionRegistry()
    if (registry === undefined) return undefined
    try {
      return registry.stateOf(session, key) as T | undefined
    } catch {
      return undefined
    }
  }

  const cwdOf = (session: unknown): string | undefined => {
    const value = projectionOf<string | null>(session, 'workingDirectory')
    return typeof value === 'string' && value.length > 0 ? value : undefined
  }

  const sessions = new Map<string, SessionTrack>()

  const trackFor = (session: unknown): SessionTrack | undefined => {
    const id = sessionKey(session)
    if (id === undefined) return undefined
    let track = sessions.get(id)
    if (track === undefined) {
      track = { id, session, calls: new Map(), pending: new Map() }
      sessions.set(id, track)
    }
    track.session = session
    return track
  }

  const rememberCall = (track: SessionTrack, callId: string, toolName: string, rawArguments: string, at: number): void => {
    track.calls.set(callId, { toolName, arguments: rawArguments, at })
    while (track.calls.size > CALLS_KEPT) {
      const oldest = track.calls.keys().next()
      if (oldest.done === true) break
      track.calls.delete(oldest.value)
    }
  }

  const onSessionEvent = (session: unknown, event: { type?: string; data?: Record<string, unknown> }): void => {
    if (disposed) return
    const track = trackFor(session)
    if (track === undefined) return
    const type = text(event?.type)
    const data = (event?.data ?? {}) as Record<string, unknown>

    if (type === 'tool/call') {
      const callId = text(data.callId)
      if (callId.length > 0) {
        const toolName = text(data.name)
        const rawArguments = text(data.arguments)
        rememberCall(track, callId, toolName, rawArguments, Date.now())
        // An approval may be asked before its call is logged; refresh any
        // pending digest that was built without the arguments.
        for (const entry of track.pending.values()) {
          if (entry.callId !== callId) continue
          entry.digest = digestOf(
            toolName.length > 0 ? toolName : entry.toolName,
            rawArguments,
            cwdOf(track.session),
            settings.previewChars,
          )
        }
      }
      return
    }

    if (type === 'approval/asked') {
      const requestId = text(data.id)
      if (requestId.length === 0) return
      const toolName = text(data.toolName)
      const callId = text(data.callId)
      const cached = callId.length > 0 ? track.calls.get(callId) : undefined
      const digest = digestOf(
        toolName.length > 0 ? toolName : (cached?.toolName ?? ''),
        cached?.arguments ?? '',
        cwdOf(track.session),
        settings.previewChars,
      )
      track.pending.set(requestId, {
        requestId,
        toolName: digest.toolName,
        ...(callId.length === 0 ? {} : { callId }),
        ...(text(data.reason).length === 0 ? {} : { reason: text(data.reason) }),
        since: Date.now(),
        digest,
      })
      while (track.pending.size > PENDING_KEPT) {
        const oldest = track.pending.keys().next()
        if (oldest.done === true) break
        track.pending.delete(oldest.value)
      }
      return
    }

    if (type === 'approval/decided') {
      const requestId = text(data.id)
      if (requestId.length > 0) track.pending.delete(requestId)
    }
  }

  /* ------------------------------------------------------------- surfaces */

  const respond = (res: ResponseLike, status: number, payload: string, head: boolean): void => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(head ? undefined : payload)
  }

  const handlePending = (req: RequestLike, res: ResponseLike): void => {
    try {
      const method = text(req.method).toUpperCase() || 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        respond(res, 405, JSON.stringify({ error: 'method not allowed' }), false)
        return
      }
      const url = new URL(text(req.url) || ROUTE_PENDING, 'http://127.0.0.1')
      const sessionId = url.searchParams.get('session') ?? ''
      const track = sessionId.length > 0 ? sessions.get(sessionId) : undefined
      const pending = track === undefined
        ? []
        : [...track.pending.values()].sort((left, right) => left.since - right.since)
      respond(res, 200, JSON.stringify({ sessionId, pending, updatedAt: Date.now() }), method === 'HEAD')
    } catch (error) {
      respond(res, 500, JSON.stringify({ error: messageOf(error) }), false)
    }
  }

  ctx.effect(() => (ctx as unknown as { webServer: { register(route: { kind: 'exact'; path: string; handler: (req: RequestLike, res: ResponseLike) => void }): () => void } }).webServer.register({
    kind: 'exact',
    path: ROUTE_PENDING,
    handler: handlePending,
  }), `${name}: pending route`)

  ctx.effect(() => ctx.on('session/event', onSessionEvent), `${name}: approval folding`)

  // The browser half reads its switches and user-extended rules from this row.
  ctx.effect(() => ctx.on('webserver/index-inject', (table: unknown[]) => {
    if (disposed) return
    table.push({
      kind: 'global',
      name: CONFIG_GLOBAL,
      value: {
        widgets: settings.widgets,
        minLevel: settings.minLevel,
        showLow: settings.showLow,
        extraHighRisk: settings.extraHighRisk,
      },
    })
  }), `${name}: display switches`)

  ctx.effect(() => () => {
    disposed = true
    sessions.clear()
  }, `${name}: disposal`)
}
