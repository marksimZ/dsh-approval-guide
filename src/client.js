/**
 * Approval guide, browser half.
 *
 * One explanatory line above the composer while an approval is pending. It
 * describes the risk in plain language and stays out of the decision: the
 * native approval card keeps its buttons, this widget only explains.
 *
 * The classification is a deliberately conservative lexical table — it never
 * guesses semantics, and anything it cannot match is "无法判断风险，请人工确认"
 * rather than "safe". Rules are data: adding one is one object in a list.
 */

window.__ModuleLoader__.load({
  id: 'dsh-approval-guide',
  factory: (require) => {
    'use strict'

    const React = require('react')

    /** Pending-approval route served by the Host half. */
    const PENDING_ROUTE = '/dsh-approval-guide/pending'

    /** One stylesheet for the widget. */
    const STYLE_ID = 'dsh-approval-guide/styles'

    /** Pending polling interval; the route is pure memory. */
    const POLL_MS = 2_000

    const DEFAULT_CONFIG = {
      widgets: { explainer: true },
      minLevel: 'medium',
      showLow: false,
      extraHighRisk: [],
    }

    const STYLES = `
.dug-root {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary);
  font-size: 12px;
  line-height: 18px;
}
.dug-root[data-level='high'] {
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, transparent);
}
.dug-root[data-level='medium'] {
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent);
}
.dug-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dug-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--dsw-alias-label-tertiary);
}
.dug-root[data-level='high'] .dug-dot { background: var(--dsw-alias-state-error-primary); }
.dug-root[data-level='medium'] .dug-dot { background: var(--dsw-alias-state-warn-primary); }
.dug-level {
  flex: none;
  font-weight: 500;
}
.dug-root[data-level='high'] .dug-level { color: var(--dsw-alias-state-error-primary); }
.dug-root[data-level='medium'] .dug-level { color: var(--dsw-alias-state-warn-primary); }
.dug-root[data-level='low'] .dug-level,
.dug-root[data-level='unknown'] .dug-level { color: var(--dsw-alias-label-secondary); }
.dug-text {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--dsw-alias-label-secondary);
}
.dug-more {
  flex: none;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 14px;
}
.dug-toggle {
  flex: none;
  height: 22px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: none;
  color: var(--dsw-alias-link);
  font: inherit;
  font-size: 11px;
  line-height: 14px;
  font-weight: 500;
  cursor: pointer;
}
.dug-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dug-toggle:focus-visible { outline: 2px solid var(--dsw-alias-link); outline-offset: 1px; }
.dug-detail {
  margin-top: 6px;
  padding-top: 6px;
  border-top: .5px solid var(--dsw-alias-border-l2);
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
  gap: 2px 10px;
  font-size: 11px;
  line-height: 16px;
  color: var(--dsw-alias-label-tertiary);
}
.dug-detail b {
  color: var(--dsw-alias-label-secondary);
  font-weight: 500;
  white-space: nowrap;
}
.dug-detail span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.dug-mono {
  font-family: var(--dsw-font-family);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary);
}
@media (prefers-reduced-motion: reduce) {
  .dug-root { transition: none; }
}
`

    /** Host-injected switches and user-extended rules. */
    const runtimeConfig = (() => {
      const injected = globalThis.__DSH_APPROVAL_GUIDE_CONFIG__
      if (injected === null || typeof injected !== 'object') return DEFAULT_CONFIG
      return {
        ...DEFAULT_CONFIG,
        ...injected,
        widgets: { ...DEFAULT_CONFIG.widgets, ...(injected.widgets ?? {}) },
        extraHighRisk: Array.isArray(injected.extraHighRisk) ? injected.extraHighRisk : [],
      }
    })()

    /** Install the stylesheet once per page. */
    function installStyles() {
      if (document.querySelector('style[data-dsh-plugin-css="' + STYLE_ID + '"]') !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.dshPlugin = 'dsh-approval-guide'
      tag.dataset.dshPluginCss = STYLE_ID
      tag.textContent = STYLES
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    /* ------------------------------------------------------------ rules */

    /** High-risk patterns: irreversible, destructive, privileged or remote-exec. */
    const HIGH_RULES = [
      { id: 'recursive-delete', pattern: /\brm\b[^\n]*\s-[a-z]*[rf][a-z]*/i, label: '递归或强制删除文件' },
      { id: 'windows-delete', pattern: /\b(Remove-Item|del|rmdir|erase)\b[^\n]*(-Recurse|\/[a-z]*[sfq])/i, label: '递归或强制删除文件' },
      { id: 'git-clean', pattern: /git\s+clean\b[^\n]*-[a-z]*[fdx]/i, label: '清理未跟踪/被忽略的文件' },
      { id: 'git-reset-hard', pattern: /git\s+reset\s+--hard\b/i, label: '丢弃未提交的改动' },
      { id: 'git-force-push', pattern: /git\s+push\b[^\n]*(--force\b|--force-with-lease\b|\s-f\b)/i, label: '强制推送远端' },
      { id: 'git-checkout-dot', pattern: /git\s+checkout\s+--\s+\./i, label: '丢弃工作区改动' },
      { id: 'disk-format', pattern: /\b(mkfs|diskpart|format\s+[a-z]:|dd\s+if=)/i, label: '格式化或覆写磁盘' },
      { id: 'privilege', pattern: /\b(sudo|runas|su\s+-)\b/i, label: '提权执行' },
      { id: 'power-state', pattern: /\b(shutdown|reboot|poweroff|halt)\b/i, label: '关机或重启' },
      { id: 'kill-force', pattern: /(taskkill\b[^\n]*\/f|Stop-Process\b[^\n]*-Force|kill\s+-9)/i, label: '强制结束进程' },
      { id: 'remote-exec', pattern: /(curl|wget|Invoke-WebRequest|iwr)\b[^\n]*\|\s*(bash|sh|zsh|python|node|powershell)\b/i, label: '下载并执行远程脚本' },
      { id: 'invoke-expression', pattern: /\b(Invoke-Expression|iex)\b/i, label: '动态执行字符串' },
      { id: 'drop-table', pattern: /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i, label: '删除数据库对象' },
      { id: 'publish-package', pattern: /\b(npm|pnpm|yarn)\s+publish\b/i, label: '发布软件包' },
      { id: 'docker-prune', pattern: /docker\s+(system\s+prune|rm\s+-f)/i, label: '强制清理容器资源' },
      { id: 'registry-delete', pattern: /\breg\s+delete\b|\bSet-ItemProperty\b[^\n]*HKLM/i, label: '修改系统注册表' },
      { id: 'chmod-recursive', pattern: /\b(chmod|chown)\s+-R\b/i, label: '递归修改权限或属主' },
      { id: 'chmod-777', pattern: /\bchmod\s+(-[a-z]+\s+)?0?777\b/i, label: '完全开放文件权限' },
    ]

    /** Medium-risk patterns: writes, installs, network, process control. */
    const MEDIUM_RULES = [
      { id: 'package-install', pattern: /\b(npm|pnpm|yarn)\s+(i|install|add)\b|\bpip\s+install\b|\bcargo\s+(add|install)\b|\bgo\s+get\b|\bgem\s+install\b/i, label: '安装依赖' },
      { id: 'git-write', pattern: /git\s+(commit|push|merge|rebase|tag)\b/i, label: '写入 Git 历史' },
      { id: 'docker', pattern: /docker\s+(run|build|compose|exec)\b/i, label: '运行容器或构建镜像' },
      { id: 'download', pattern: /\b(curl|wget|Invoke-WebRequest|iwr)\b/i, label: '访问网络并下载' },
      { id: 'move-copy', pattern: /\b(mv|cp|robocopy|xcopy)\b/i, label: '移动或复制文件' },
      { id: 'permissions', pattern: /\b(chmod|chown|icacls)\b/i, label: '修改权限' },
      { id: 'write-command', pattern: /\b(tee|Set-Content|Out-File|New-Item)\b/i, label: '写入文件' },
      { id: 'sed-in-place', pattern: /\bsed\s+-i\b/i, label: '原地修改文件' },
      { id: 'local-server', pattern: /\b(python\s+-m\s+http\.server|npm\s+run|pnpm\s+(run|dev)|vite|next\s+dev|serve)\b/i, label: '启动本地服务' },
      { id: 'process-signal', pattern: /\b(kill|taskkill|Stop-Process)\b/i, label: '结束进程' },
    ]

    /** Low-risk patterns: read-only inspection. */
    const LOW_RULES = [
      { id: 'read-command', pattern: /\b(ls|dir|cat|type|head|tail|grep|rg|fd|find|stat|wc|du|df|pwd|echo|which|where|whoami|uname|sort|uniq|cut|awk)\b/i, label: '只读命令' },
      { id: 'git-read', pattern: /^\s*git\s+(status|diff|log|show|branch|remote|rev-parse|describe|blame)\b/i, label: '只读 Git 查询' },
      { id: 'version-query', pattern: /^\s*(node|npm|pnpm|python|pip|git|go|cargo)\s+(-v|--version)\b/i, label: '版本查询' },
      { id: 'powershell-read', pattern: /\bGet-(ChildItem|Content|Item|ItemProperty|Command|Process|Location|Date)\b/i, label: '只读查询' },
    ]

    /** Tool-name knowledge that does not depend on the command text. */
    const WRITE_TOOLS = ['write', 'edit', 'str_replace_editor', 'apply_patch', 'multi_edit', 'notebook_edit']
    const READ_TOOLS = ['read', 'glob', 'grep', 'ls', 'list', 'find', 'search']
    const NETWORK_TOOLS = ['web_fetch', 'web_search', 'fetch']
    const DELEGATE_TOOLS = ['subagent', 'workflow', 'task', 'delegate', 'ralph', 'workflow_run']
    const COMMAND_TOOLS = ['bash', 'powershell', 'shell', 'terminal', 'run', 'exec', 'cmd']

    /** Paths that are never "just the workspace". */
    const SYSTEM_PATH = /(^|[\\/])(Windows|Program Files( \(x86\))?|System32|etc|usr|bin|sbin|var|boot|\.ssh|\.aws|\.gnupg)([\\/]|$)/i
    const ABSOLUTE_PATH = /^([a-zA-Z]:[\\/]|[\\/])/

    const RANK = { low: 1, medium: 2, high: 3, unknown: 0 }
    const LEVEL_LABEL = { high: '高风险', medium: '注意', low: '只读', unknown: '无法判断' }
    const ADVICE = {
      high: '建议先确认影响范围；不需要时选择拒绝。',
      medium: '确认这是你期望的改动；不可撤销的操作请先备份。',
      low: '',
      unknown: '插件无法判断这条命令的风险，请人工确认后再允许。',
    }

    /** Compile the user-extended high-risk patterns; invalid ones are ignored. */
    function extraHighRules(patterns) {
      const rules = []
      for (const source of patterns ?? []) {
        try {
          rules.push({ id: 'custom-high', pattern: new RegExp(source, 'i'), label: '自定义高风险规则' })
        } catch {
          // A bad pattern must not break the widget.
        }
      }
      return rules
    }

    /** Run one rule list over the evidence text. */
    function matched(ruleList, text) {
      const labels = []
      for (const rule of ruleList) if (rule.pattern.test(text)) labels.push(rule.label)
      return labels
    }

    /** Whether a path sits outside the workspace (or in a system location). */
    function pathScope(path, cwd) {
      if (typeof path !== 'string' || path.length === 0) return null
      if (SYSTEM_PATH.test(path)) return { scope: '系统目录', escalate: true }
      if (!ABSOLUTE_PATH.test(path)) return { scope: '工作区', escalate: false }
      const normalized = path.replaceAll('\\', '/').toLowerCase()
      const root = typeof cwd === 'string' && cwd.length > 0 ? cwd.replaceAll('\\', '/').toLowerCase() : ''
      if (root.length > 0) {
        return normalized.startsWith(root) ? { scope: '工作区', escalate: false } : { scope: '工作区之外', escalate: true }
      }
      return { scope: '绝对路径（可能在工作区之外）', escalate: true }
    }

    /**
     * Classify one approval digest. Pure and exported to the spec test.
     *
     * @param {{ toolName?: string, command?: string, path?: string, url?: string, cwd?: string, preview?: string }} digest
     * @param {{ extraHighRisk?: readonly string[] }} [config]
     */
    function classify(digest, config) {
      const toolName = String(digest?.toolName ?? '').toLowerCase()
      const command = typeof digest?.command === 'string' ? digest.command : ''
      const path = typeof digest?.path === 'string' ? digest.path : ''
      const url = typeof digest?.url === 'string' ? digest.url : ''
      const evidence = [command, path, url].filter(part => part.length > 0).join('\n')

      const high = [...matched(HIGH_RULES, evidence), ...matched(extraHighRules(config?.extraHighRisk), evidence)]
      const medium = matched(MEDIUM_RULES, evidence)
      const low = matched(LOW_RULES, evidence)

      let level = 'unknown'
      const findings = []
      const add = labels => {
        for (const label of labels) if (!findings.includes(label)) findings.push(label)
      }

      let scope = '工作区'
      if (url.length > 0) {
        add(['访问网络'])
        scope = '网络'
      }

      const pathInfo = pathScope(path, digest?.cwd)
      if (pathInfo !== null) {
        scope = pathInfo.scope
        if (pathInfo.escalate) add(['工作区之外的路径'])
      }

      // Tool-name knowledge first, then lexical evidence; the worst wins.
      if (WRITE_TOOLS.includes(toolName)) {
        add(['写入文件'])
        level = pathInfo !== null && pathInfo.escalate ? 'high' : 'medium'
      } else if (READ_TOOLS.includes(toolName)) {
        add(['只读访问'])
        level = 'low'
      } else if (NETWORK_TOOLS.includes(toolName)) {
        add(['访问网络'])
        scope = '网络'
        level = 'medium'
      } else if (DELEGATE_TOOLS.includes(toolName)) {
        add(['委派子任务执行'])
        level = 'medium'
      } else if (high.length > 0) {
        add(high)
        level = 'high'
      } else if (medium.length > 0) {
        add(medium)
        level = 'medium'
      } else if (low.length > 0 && COMMAND_TOOLS.includes(toolName)) {
        add(low)
        level = 'low'
      }

      // A high-risk pattern always wins, whatever the tool name says.
      if (high.length > 0 && level !== 'high') {
        add(high)
        level = 'high'
      } else if (medium.length > 0 && level === 'low') {
        add(medium)
        level = 'medium'
      }
      if (pathInfo !== null && pathInfo.escalate) level = 'high'

      if (findings.length === 0) findings.push('无法匹配已知规则')

      return {
        level,
        levelLabel: LEVEL_LABEL[level],
        findings,
        scope,
        advice: ADVICE[level],
        evidence: command.length > 0 ? command : (path.length > 0 ? path : (url.length > 0 ? url : digest?.preview ?? '')),
      }
    }

    /** Whether the configured display threshold admits one level. */
    function shouldShow(level, config) {
      const settings = { ...DEFAULT_CONFIG, ...(config ?? {}) }
      if (level === 'unknown') return true
      if (settings.showLow === true) return true
      const floor = RANK[settings.minLevel] ?? RANK.medium
      return (RANK[level] ?? 0) >= floor
    }

    /** Pick the most severe pending approval that passes the threshold. */
    function pickWorst(pending, config) {
      const shown = []
      for (const entry of pending ?? []) {
        const view = classify(entry?.digest ?? {}, config)
        if (shouldShow(view.level, config)) shown.push({ entry, view })
      }
      shown.sort((left, right) => {
        const rank = (RANK[right.view.level] ?? 0) - (RANK[left.view.level] ?? 0)
        return rank !== 0 ? rank : (left.entry?.since ?? 0) - (right.entry?.since ?? 0)
      })
      if (shown.length === 0) return null
      return { entry: shown[0].entry, view: shown[0].view, others: shown.length - 1 }
    }

    /* ---------------------------------------------------------- widget */

    /** Advisory line above the composer while an approval is pending. */
    function ApprovalExplainer(props) {
      const sessionId = props.sessionId
      const config = props.kit?.config ?? runtimeConfig
      const [pending, setPending] = React.useState([])
      const [open, setOpen] = React.useState(false)
      const aliveRef = React.useRef(true)

      React.useEffect(() => {
        aliveRef.current = true
        const load = async () => {
          try {
            if (typeof document !== 'undefined' && document.hidden === true) return
            const response = await fetch(PENDING_ROUTE + '?session=' + encodeURIComponent(sessionId), {
              headers: { accept: 'application/json' },
            })
            if (!response.ok) return
            const body = await response.json()
            if (!aliveRef.current) return
            if (body !== null && typeof body === 'object' && Array.isArray(body.pending)) {
              setPending(body.pending)
              if (body.pending.length === 0) setOpen(false)
            }
          } catch {
            // Keep the last view; the next poll retries.
          }
        }
        void load()
        const timer = setInterval(() => { void load() }, POLL_MS)
        return () => {
          aliveRef.current = false
          clearInterval(timer)
        }
      }, [sessionId])

      const worst = pickWorst(pending, config)
      if (worst === null) return null
      const view = worst.view

      const rows = []
      if (view.evidence.length > 0) rows.push({ label: '判定依据', value: view.evidence })
      rows.push({ label: '影响范围', value: view.scope })
      if (view.advice.length > 0) rows.push({ label: '建议', value: view.advice })
      if (typeof worst.entry?.reason === 'string' && worst.entry.reason.length > 0) {
        rows.push({ label: '原始原因', value: worst.entry.reason })
      }

      return React.createElement('div', { className: 'dug-root', 'data-level': view.level, role: 'status' },
        React.createElement('div', { className: 'dug-head' },
          React.createElement('span', { className: 'dug-dot', 'aria-hidden': 'true' }),
          React.createElement('span', { className: 'dug-level' }, view.levelLabel),
          React.createElement('span', { className: 'dug-text' }, view.findings.join(' · ') + ' · ' + view.scope),
          worst.others > 0
            ? React.createElement('span', { className: 'dug-more' }, '还有 ' + String(worst.others) + ' 个待审批')
            : null,
          React.createElement('button', {
            type: 'button',
            className: 'dug-toggle',
            'aria-expanded': open ? 'true' : 'false',
            onClick: () => { setOpen(value => !value) },
          }, open ? '收起' : '详情')),
        open
          ? React.createElement('div', { className: 'dug-detail' },
            rows.map(row => React.createElement(React.Fragment, { key: row.label },
              React.createElement('b', undefined, row.label),
              React.createElement('span', { className: row.label === '判定依据' ? 'dug-mono' : undefined }, row.value))))
          : null)
    }

    /* ------------------------------------------------------------ apply */

    function apply(ctx) {
      ctx.effect(() => installStyles(), 'approval-guide: styles')
      if (runtimeConfig.widgets.explainer !== false) {
        ctx.effect(() => ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
          name: 'conversation.input.dock',
          id: 'approval-guide',
          order: 30,
          label: '审批解释',
        }, entryProps => React.createElement(ApprovalExplainer, {
          ...entryProps,
          kit: { config: runtimeConfig },
        }))), 'approval-guide: explainer')
      }
    }

    return {
      name: 'dsh-approval-guide',
      inject: ['slots'],
      apply,
      ...globalThis.__DSH_APPROVAL_GUIDE_TEST__ === true
        ? {
          __internals: {
            classify,
            shouldShow,
            pickWorst,
            HIGH_RULES,
            MEDIUM_RULES,
            LOW_RULES,
            pathScope,
            runtimeConfig,
            STYLE_ID,
          },
        }
        : {},
    }
  },
})
