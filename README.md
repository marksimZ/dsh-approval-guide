# dsh-approval-guide

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that explains a
pending approval in plain language — **without touching the native approval UI**.

```
composer area
┌───────────────────────────────────────────────────────────────┐
│ ⚠ 高风险  递归或强制删除文件 · 工作区                  [详情] │  ← this plugin
├───────────────────────────────────────────────────────────────┤
│ … the native approval card (command, Allow, Deny) stays …     │  ← untouched
└───────────────────────────────────────────────────────────────┘
```

Expanding the line adds `判定依据` (the command / path), `影响范围` (workspace / outside / system /
network), `建议`, and the agent's own `原始原因`. It never offers Allow/Deny: the decision stays
where it belongs.

## Why it does not sit inside the approval card

`conversation.approval.detail` is a **single** seat with
`replaceRisk: "shadows-shipped-ui"`; its current occupant is the shipped `ApprovalCommand`.
Registering into it would *replace* the native card (including its buttons), not add to it. This
plugin therefore renders into `conversation.input.dock` and treats the native card as read-only.

## How it classifies

A conservative lexical table — it never guesses semantics, and anything it cannot match is
**`无法判断风险，请人工确认`**, never "safe".

| Level | Signals (examples) | Meaning |
|---|---|---|
| **高风险** | `rm -rf`, `git clean -fdx`, `git reset --hard`, `git push --force`, `mkfs`/`dd`, `sudo`, `shutdown`, `taskkill /f`, `curl … \| sh`, `Drop Table`, `npm publish`, `docker system prune`, `chmod -R`/`777`, system registry edits | irreversible, privileged or remote execution |
| **注意** | package installs, `git commit`/`push`, `docker run/build`, downloads, `mv`/`cp`, `sed -i`, write tools | changes files, dependencies or Git history |
| **只读** | `ls`, `cat`, `grep`, `git status`, `node -v`, `read`/`glob`/`grep` tools | inspection only |
| **无法判断** | anything unmatched | ask a human — never assume safe |

Extra rules:

- **Scope**: a path or command touching a system location or an absolute path outside the
  workspace is escalated to high and labelled `工作区之外` / `系统目录`;
- **Network**: `web_fetch` / `web_search` / `curl` / `wget` get the `网络` scope;
- **Write tools** (`write`, `edit`, `str_replace_editor`, …) are medium inside the workspace, high
  outside it;
- **Sanitized digest**: file contents, patches and prompts are replaced by `<N chars>` on the Host
  before they cross the wire; the preview is bounded by `previewChars`.

The table lives in `src/client.js` as `HIGH_RULES` / `MEDIUM_RULES` / `LOW_RULES`; adding a rule is
one object. `scripts/client-spec.mjs` pins the whole table and the "unknown stays unknown" rule.

## Requirements

- A DSH client that composes `webServer` and `sessionProjections` (Desktop client and `dsh web`).
- Node 20+ only for the test/install scripts; the plugin has **no build step**.

## Install

```sh
git clone https://github.com/marksimZ/dsh-approval-guide.git dsh-approval-guide
dsh web --patch /absolute/path/to/dsh-approval-guide/cordis.patch.yml
# or permanently:
node scripts/install.mjs --dry-run
node scripts/install.mjs
node scripts/verify-deployed.mjs --url http://127.0.0.1:<GUI 端口>
```

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `widgets.explainer` | `true` | Register the explanation line |
| `minLevel` | `medium` | Lowest level shown: `high` / `medium` / `low` (`unknown` is always shown) |
| `showLow` | `false` | Also show read-only approvals |
| `previewChars` | `400` | Maximum characters of the sanitized argument preview |
| `extraHighRisk` | `[]` | Extra high-risk regular expressions (e.g. your own dangerous commands) |

## Architecture

```text
Host half (src/index.ts)
  ctx.on('session/event')                     → tool/call cache, approval/asked, approval/decided
  ctx.sessionProjections.stateOf('workingDirectory') → scope for the digest
  GET /dsh-approval-guide/pending?session=…   → pending list with sanitized digests
  globalThis.__DSH_APPROVAL_GUIDE_CONFIG__    → display switches + custom rules

Browser half (src/client.js)
  conversation.input.dock → poll pending, classify, render one explanation line
```

**Why a Host half?** The approval payload and the correlated tool-call arguments live in the
Host's session log; the browser only receives the digest. The classification itself is pure and
runs in the browser so the copy ships with the widget.

## Tests

```sh
npm test          # classifier spec + bundle smoke + theme tokens + visual tokens
npm run test:host # approval lifecycle over the real pending route
npm run verify    # read-only probe of a running GUI
```

| Script | What it pins |
|---|---|
| `scripts/client-spec.mjs` | every rule family, tool-name mapping, scope escalation, the unknown default, the display threshold, worst-pending selection |
| `scripts/client-smoke.mjs` | bundle contract, dock registration, the explainer switch |
| `scripts/host-smoke.mjs` | pending lifecycle, digest extraction, payload sanitization, digest refresh when the call arrives late, route edges |
| `scripts/theme-tokens.mjs` | every `var(--dsw-*)` is declared by the shipped theme |
| `scripts/visual-tokens.mjs` | no raw colours, radii/type from the theme scale, no infinite animation |
| `scripts/verify-deployed.mjs` | the running GUI serves the bundle and the pending route |

## Limitations

- **Lexical, not semantic.** Obfuscated commands (`base64 -d | sh`, generated scripts) land in
  `无法判断`; that is the intended conservative behaviour.
- **Only what the approval names.** Risk is judged from the approved tool call, not from the
  broader plan behind it.
- **No decision buttons by design.** The native card owns Allow/Deny; this plugin only explains.
- **Explanations start when the plugin loads.** An approval already pending before the Host half
  mounted has no cached tool call, so its line may read `无法匹配已知规则` until the call is seen.

## License

MIT — see [LICENSE](LICENSE).
