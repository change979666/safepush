#!/usr/bin/env node
/**
 * SafePush 🛡️ — AI-friendly safe git push with secret scanning.
 *
 * Zero dependencies. Node >= 16.
 *
 *   node safepush.mjs [repoPath] [-m message] [--remote origin] [--branch main]
 *                     [--dry-run] [--lang zh|en|auto] [--strict] [--force]
 *                     [--no-color] [--json]
 *
 * Flow: status → add (-A) → secret scan (staged) → commit → push
 *
 * Exit codes: 0 ok · 1 runtime error · 2 blocked by secret findings
 */

import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

/* ---------------------------------------------------------------- i18n */

const MESSAGES = {
  zh: {
    title: 'SafePush 🛡️ 安全推送',
    notRepo: '不是 Git 仓库（未找到 .git）：{path}',
    gitMissing: '找不到 git 命令，请先安装 Git。',
    branch: '分支：{branch}　远程：{remote}',
    dirty: '检测到 {count} 个待处理变更，执行 git add -A …',
    cleanNoAhead: '工作区干净，且没有领先远程的本地提交，无需推送。',
    ahead: '本地领先远程 {count} 个提交。',
    scanning: '正在扫描暂存区中的敏感信息（{count} 个文件）…',
    scanClean: '✓ 密钥扫描通过，未发现敏感信息。',
    foundCritical: '✗ 发现 {count} 处疑似密钥/凭据（阻断级）：',
    foundWarn: '⚠ 发现 {count} 处可疑内容（警告级）：',
    warnPassed: 'ℹ 警告级发现不阻断，继续执行（可用 --strict 收紧）。',
    blocked:
      '\n🛑 已阻止提交与推送。请移除上述敏感信息后重试；\n   如确认误报，可加 --force 强行继续（风险自负）。',
    blockedStrict: '\n🛑 --strict 模式：警告级发现同样视为阻断。',
    forceUsed: '⚠ --force 已启用：忽略阻断级发现，继续执行（风险自负）！',
    dryRun: '（dry-run 模式：以下操作仅展示，不会真正执行）',
    wouldCommit: '将提交：{message}',
    wouldPush: '将推送：{remote}/{branch}',
    committing: '提交中：{message}',
    nothingToCommit: '没有新的变更需要提交。',
    committed: '✓ 提交完成 {hash}',
    commitFailed: '提交失败：{err}',
    pushing: '推送到 {remote}/{branch} …',
    pushed: '✓ 推送成功 → {remote}/{branch}',
    pushFailed: '推送失败：{err}',
    pushBehindHint: '远程有新提交？先运行 git pull --rebase 后再试，或使用 --rebase 自动变基。',
    rebasing: '检测到落后远程，执行 git pull --rebase …',
    rebaseFailed: '自动变基失败：{err}',
    summary: '摘要',
    usageHint: '用法：node safepush.mjs [repoPath] [-m 信息] [--dry-run] [--lang zh|en]',
    findingFile: '文件',
    findingLine: '行',
    findingRule: '规则',
    findingMatch: '内容',
    yes: '是',
    no: '否',
  },
  en: {
    title: 'SafePush 🛡️ safe push',
    notRepo: 'Not a git repository (.git not found): {path}',
    gitMissing: 'git command not found. Please install Git first.',
    branch: 'Branch: {branch}　Remote: {remote}',
    dirty: '{count} pending change(s), running git add -A …',
    cleanNoAhead: 'Worktree clean and no unpushed local commits — nothing to do.',
    ahead: 'Local is {count} commit(s) ahead of remote.',
    scanning: 'Scanning staged files for secrets ({count} files) …',
    scanClean: '✓ Secret scan passed, nothing suspicious.',
    foundCritical: '✗ {count} likely secret/credential finding(s) (blocking):',
    foundWarn: '⚠ {count} suspicious finding(s) (warning level):',
    warnPassed: 'ℹ Warning-level findings do not block; continuing (use --strict to tighten).',
    blocked:
      '\n🛑 Commit & push blocked. Remove the secrets above and retry;\n   if these are false positives, pass --force to proceed (at your own risk).',
    blockedStrict: '\n🛑 --strict mode: warning-level findings also block.',
    forceUsed: '⚠ --force enabled: ignoring blocking findings (at your own risk)!',
    dryRun: '(dry-run: actions below are shown, not executed)',
    wouldCommit: 'Would commit: {message}',
    wouldPush: 'Would push: {remote}/{branch}',
    committing: 'Committing: {message}',
    nothingToCommit: 'Nothing new to commit.',
    committed: '✓ Committed {hash}',
    commitFailed: 'Commit failed: {err}',
    pushing: 'Pushing to {remote}/{branch} …',
    pushed: '✓ Pushed → {remote}/{branch}',
    pushFailed: 'Push failed: {err}',
    pushBehindHint: 'Remote has new commits? Run git pull --rebase first, or retry with --rebase.',
    rebasing: 'Behind remote detected, running git pull --rebase …',
    rebaseFailed: 'Auto-rebase failed: {err}',
    summary: 'Summary',
    usageHint: 'Usage: node safepush.mjs [repoPath] [-m msg] [--dry-run] [--lang zh|en]',
    findingFile: 'file',
    findingLine: 'line',
    findingRule: 'rule',
    findingMatch: 'match',
    yes: 'yes',
    no: 'no',
  },
}

/* ------------------------------------------------------- secret rules */

/** Definite credential shapes → blocking. */
const CONTENT_RULES = [
  { id: 'github-classic', sev: 'critical', label: 'GitHub classic token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { id: 'github-finegrained', sev: 'critical', label: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: 'openrouter', sev: 'critical', label: 'OpenRouter key', re: /\bsk-or-v1-[A-Za-z0-9]{16,}\b/g },
  { id: 'openai-like', sev: 'critical', label: 'OpenAI-style key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'aws-access-key', sev: 'critical', label: 'AWS access key', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { id: 'private-key', sev: 'critical', label: 'PEM private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { id: 'google-sa', sev: 'critical', label: 'Google service-account JSON', re: /"type"\s*:\s*"service_account"/g },
  { id: 'slack-token', sev: 'critical', label: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'url-credentials', sev: 'warn', label: 'Credentials embedded in URL', re: /\bhttps?:\/\/[^\s/:@]+:[^\s/@]{8,}@/g },
  { id: 'jwt', sev: 'warn', label: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*\b/g },
  {
    id: 'generic-secret',
    sev: 'warn',
    label: 'Hardcoded secret assignment',
    re: /\b(api[_-]?key|apikey|secret|passwd|password|pwd|token)\b\s*[:=]\s*["'][^"'\s]{8,}["']/gi,
  },
]

/** Files that must never be committed → blocking. */
const FILE_RULES = [
  { id: 'env-file', sev: 'critical', label: '.env file', test: (f) => /(^|\/)\.env$/i.test(f) || (/^\.env\./i.test(path.posix.basename(f)) && !/example|sample|template/i.test(f)) },
  { id: 'dev-vars', sev: 'critical', label: 'wrangler .dev.vars', test: (f) => /\.dev\.vars/i.test(f) && !/example|sample/i.test(f) },
  { id: 'service-account', sev: 'critical', label: 'service-account JSON', test: (f) => /service[-_]?account/i.test(f) && /\.json$/i.test(f) },
  { id: 'key-file', sev: 'critical', label: 'private key file', test: (f) => /\.(pem|key|p12|pfx)$/i.test(f) || /(^|\/)id_(rsa|ed25519|ecdsa)(\.[^.]+)?$/i.test(f) },
  { id: 'credentials-json', sev: 'critical', label: 'credentials JSON', test: (f) => /(^|\/)credentials[^/]*\.json$/i.test(f) },
]

/* ------------------------------------------------------------ helpers */

function maskSecret(text) {
  const s = String(text)
  if (s.length <= 10) return s.slice(0, 2) + '***'
  return s.slice(0, 6) + '***' + s.slice(-3)
}

function detectLang(explicit) {
  if (explicit === 'zh' || explicit === 'en') return explicit
  const lang = `${process.env.LANG || ''}${process.env.LANGUAGE || ''}${process.env.LC_ALL || ''}`.toLowerCase()
  return lang.includes('zh') ? 'zh' : 'en'
}

class Out {
  constructor(opts) {
    this.json = opts.json
    this.lang = opts.lang
    this.color = opts.color
    this.steps = []
  }
  t(key, vars = {}) {
    let s = MESSAGES[this.lang][key] ?? MESSAGES.en[key] ?? key
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v))
    return s
  }
  say(msg) {
    if (!this.json) console.log(this.color ? msg : stripAnsi(msg))
    this.steps.push(stripAnsi(msg))
  }
  result(payload) {
    if (this.json) console.log(JSON.stringify(payload, null, 2))
  }
}

function stripAnsi(s) {
  // biome-ignore lint: tiny local helper
  return String(s).replace(/\x1B\[[0-9;]*m/g, '')
}

const c = (enabled) =>
  enabled
    ? {
        red: (s) => `\x1B[31m${s}\x1B[39m`,
        green: (s) => `\x1B[32m${s}\x1B[39m`,
        yellow: (s) => `\x1B[33m${s}\x1B[39m`,
        cyan: (s) => `\x1B[36m${s}\x1B[39m`,
        gray: (s) => `\x1B[90m${s}\x1B[39m`,
        bold: (s) => `\x1B[1m${s}\x1B[22m`,
      }
    : { red: (s) => s, green: (s) => s, yellow: (s) => s, cyan: (s) => s, gray: (s) => s, bold: (s) => s }

function runGit(repoPath, args) {
  const res = spawnSync('git', args, { cwd: repoPath, encoding: 'utf8', windowsHide: true })
  if (res.error && res.error.code === 'ENOENT') return { code: -1, out: '', err: 'GIT_NOT_FOUND' }
  return { code: res.status ?? -1, out: res.stdout || '', err: res.stderr || '' }
}

/* --------------------------------------------------------------- main */

function parseArgs(argv) {
  const opts = {
    repoPath: process.cwd(),
    message: '',
    remote: 'origin',
    branch: '',
    dryRun: false,
    lang: 'auto',
    strict: false,
    force: false,
    rebase: false,
    json: false,
    color: process.stdout.isTTY,
    help: false,
  }
  const rest = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    switch (a) {
      case '-m': opts.message = argv[++i] || ''; break
      case '--remote': opts.remote = argv[++i] || 'origin'; break
      case '--branch': opts.branch = argv[++i] || ''; break
      case '--dry-run': opts.dryRun = true; break
      case '--lang': opts.lang = argv[++i] || 'auto'; break
      case '--strict': opts.strict = true; break
      case '--force': opts.force = true; break
      case '--rebase': opts.rebase = true; break
      case '--json': opts.json = true; break
      case '--no-color': opts.color = false; break
      case '-h': case '--help': opts.help = true; break
      default: if (!a.startsWith('-')) rest.push(a)
    }
  }
  if (rest.length > 0) opts.repoPath = path.resolve(rest[0])
  return opts
}

function printHelp(out, color) {
  const zh = MESSAGES.zh.usageHint
  const en = MESSAGES.en.usageHint
  const body = [
    'SafePush 🛡️ — safe git push with secret scanning',
    '',
    zh,
    en,
    '',
    'Options:',
    '  [repoPath]     目标仓库路径，默认当前目录 / target repo, defaults to cwd',
    '  -m <msg>       提交信息 / commit message',
    '  --remote <n>   远程名，默认 origin / remote name, default origin',
    '  --branch <n>   分支名，默认当前分支 / branch, defaults to current',
    '  --dry-run      只演示不执行 / show what would happen, do nothing',
    '  --lang zh|en   输出语言，auto 按 LANG 自动 / output language',
    '  --strict       警告级发现也阻断 / warning-level findings also block',
    '  --force        忽略阻断级发现强行推送 / override blocking findings',
    '  --json         机器可读输出 / machine-readable output',
    '  --no-color     关闭彩色输出 / disable colors',
  ]
  console.log(body.join('\n').replace(/\x1B\[[0-9;]*m/g, ''))
  void out
  void color
}

function scanStaged(repoPath, out, color, files) {
  /** @type {Array<{file:string,line:number,rule:string,label:string,match:string}>} */
  const findings = []
  for (const relFile of files) {
    const norm = relFile.replaceAll('\\', '/')
    for (const rule of FILE_RULES) {
      if (rule.test(norm)) {
        findings.push({ file: relFile, line: 0, rule: rule.id, label: rule.label, match: rule.label })
      }
    }
    const abs = path.join(repoPath, relFile)
    if (!existsSync(abs)) continue
    let buf
    try {
      buf = readFileSync(abs)
    } catch {
      continue
    }
    if (buf.includes(0)) continue // binary
    if (buf.byteLength > 2 * 1024 * 1024) continue // cap huge files
    const lines = buf.toString('utf8').split(/\r?\n/)
    const seen = new Set()
    for (let ln = 0; ln < lines.length; ln++) {
      const lineText = lines[ln]
      for (const rule of CONTENT_RULES) {
        rule.re.lastIndex = 0
        let m
        while ((m = rule.re.exec(lineText)) !== null) {
          const key = `${norm}:${ln}:${rule.id}:${maskSecret(m[0])}`
          if (seen.has(key)) continue
          seen.add(key)
          findings.push({ file: relFile, line: ln + 1, rule: rule.id, label: rule.label, match: maskSecret(m[0]) })
        }
      }
    }
  }
  const critical = findings.filter((f) => severityOf(f) === 'critical')
  const warn = findings.filter((f) => severityOf(f) === 'warn')
  return { findings, critical, warn }

  function severityOf(f) {
    const fr = FILE_RULES.find((r) => r.id === f.rule)
    if (fr) return fr.sev
    const cr = CONTENT_RULES.find((r) => r.id === f.rule)
    return cr ? cr.sev : 'warn'
  }
}

function renderFindings(findings, out, color) {
  for (const f of findings) {
    out.say(
      color.gray(
        `  ${out.t('findingFile')}: ${f.file}　${out.t('findingLine')}: ${f.line || '-'}　${out.t('findingRule')}: ${f.label}　${out.t('findingMatch')}: ${f.match}`,
      ),
    )
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    printHelp()
    return 0
  }
  const lang = detectLang(opts.lang)
  const out = new Out({ json: opts.json, lang, color: opts.color })
  const col = c(opts.color && !opts.json)

  const payload = { ok: false, lang, repo: opts.repoPath, steps: [], findings: [], committed: null, pushed: null }

  if (!existsSync(path.join(opts.repoPath, '.git'))) {
    out.say(col.red(out.t('notRepo', { path: opts.repoPath })))
    out.result({ ...payload, ok: false, error: 'not_a_git_repo' })
    return 1
  }
  const probe = runGit(opts.repoPath, ['rev-parse', '--is-inside-work-tree'])
  if (probe.code === -1 && probe.err === 'GIT_NOT_FOUND') {
    out.say(col.red(out.t('gitMissing')))
    out.result({ ...payload, error: 'git_not_found' })
    return 1
  }

  const branch =
    opts.branch ||
    (() => {
      const r = runGit(opts.repoPath, ['rev-parse', '--abbrev-ref', 'HEAD'])
      const b = r.out.trim()
      return !b || b === 'HEAD' ? '' : b
    })()
  if (!branch) {
    out.say(col.red('detached HEAD: use --branch'))
    out.result({ ...payload, error: 'detached_head' })
    return 1
  }
  out.say(col.bold(out.t('title')) + col.gray(`  (${opts.repoPath})`))
  out.say(col.cyan(out.t('branch', { branch, remote: opts.remote })))
  payload.branch = branch
  payload.remote = opts.remote

  // ---- stage ----
  const st = runGit(opts.repoPath, ['status', '--porcelain'])
  const dirtyLines = st.out.split('\n').filter(Boolean)
  if (st.code !== 0) {
    out.say(col.red(out.t('commitFailed', { err: st.err.trim() })))
    out.result({ ...payload, error: st.err.trim() })
    return 1
  }
  if (dirtyLines.length > 0) {
    out.say(col.yellow(out.t('dirty', { count: dirtyLines.length })))
    payload.stagedCount = dirtyLines.length
    if (!opts.dryRun) {
      const add = runGit(opts.repoPath, ['add', '-A'])
      if (add.code !== 0) {
        out.say(col.red(out.t('commitFailed', { err: add.err.trim() })))
        out.result({ ...payload, error: add.err.trim() })
        return 1
      }
    }
  }

  // ---- scan staged ----
  let stagedFiles = []
  if (dirtyLines.length > 0) {
    const ls = runGit(opts.repoPath, ['diff', '--cached', '--name-only'])
    stagedFiles = ls.out.split('\n').map((s) => s.trim()).filter(Boolean)
  }
  if (stagedFiles.length > 0) {
    out.say(col.cyan(out.t('scanning', { count: stagedFiles.length })))
    const { findings, critical, warn } = scanStaged(opts.repoPath, out, col, stagedFiles)
    payload.findings = findings.map(({ file, line, rule, match }) => ({ file, line, rule, match }))
    if (findings.length === 0) {
      out.say(col.green(out.t('scanClean')))
    } else if (critical.length > 0) {
      out.say(col.red(out.t('foundCritical', { count: critical.length })))
      renderFindings(critical, out, col)
      if (warn.length > 0) {
        out.say(col.yellow(out.t('foundWarn', { count: warn.length })))
        renderFindings(warn, out, col)
      }
      if (!opts.force) {
        out.say(col.red(out.t('blocked')))
        payload.blocked = 'critical'
        out.result({ ...payload, ok: false })
        return 2
      }
      out.say(col.yellow(out.t('forceUsed')))
    } else if (warn.length > 0) {
      out.say(col.yellow(out.t('foundWarn', { count: warn.length })))
      renderFindings(warn, out, col)
      if (opts.strict) {
        out.say(col.red(out.t('blockedStrict')))
        payload.blocked = 'strict'
        out.result({ ...payload, ok: false })
        return 2
      }
      out.say(col.gray(out.t('warnPassed')))
    }
  } else {
    out.say(col.green(out.t('scanClean')))
  }

  // ---- commit ----
  let hash = null
  const stagedNow = dirtyLines.length > 0
  if (stagedNow) {
    const message = opts.message || `chore: safepush update ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`
    if (opts.dryRun) {
      out.say(col.cyan(out.t('wouldCommit', { message })))
      out.say(col.cyan(out.t('wouldPush', { remote: opts.remote, branch })))
      payload.dryRun = true
      payload.ok = true
      out.result(payload)
      return 0
    }
    out.say(out.t('committing', { message }))
    const cm = runGit(opts.repoPath, ['commit', '-m', message])
    if (cm.code !== 0) {
      out.say(col.red(out.t('commitFailed', { err: cm.err.trim() })))
      out.result({ ...payload, error: cm.err.trim() })
      return 1
    }
    const bracket = /\[[^\s]+ ([^\s\]]+)\]/.exec(cm.out)
    hash = bracket ? bracket[1] : null
    out.say(col.green(out.t('committed', { hash: (hash || '').slice(0, 9) })))
    payload.committed = { message, hash }
  } else {
    const ahead = runGit(opts.repoPath, ['rev-list', '--count', `${opts.remote}/${branch}..HEAD`])
    const count = Number.parseInt(ahead.out.trim() || '0', 10)
    if (Number.isFinite(count) && count > 0) {
      out.say(out.t('ahead', { count }))
    } else {
      out.say(col.green(out.t('cleanNoAhead')))
      payload.ok = true
      out.result(payload)
      return 0
    }
  }

  // ---- optional rebase ----
  if (opts.rebase) {
    const behind = runGit(opts.repoPath, ['rev-list', '--count', `HEAD..${opts.remote}/${branch}`])
    if (Number.parseInt(behind.out.trim() || '0', 10) > 0) {
      out.say(col.yellow(out.t('rebasing')))
      const rb = runGit(opts.repoPath, ['pull', '--rebase', opts.remote, branch])
      if (rb.code !== 0) {
        out.say(col.red(out.t('rebaseFailed', { err: rb.err.trim() })))
        out.result({ ...payload, error: rb.err.trim() })
        return 1
      }
    }
  }

  // ---- push ----
  out.say(col.cyan(out.t('pushing', { remote: opts.remote, branch })))
  const push = runGit(opts.repoPath, ['push', opts.remote, `HEAD:${branch}`])
  if (push.code !== 0) {
    const errText = push.err.trim() || push.out.trim()
    out.say(col.red(out.t('pushFailed', { err: errText.split('\n')[0] || 'unknown' })))
    out.say(col.gray(out.t('pushBehindHint')))
    payload.error = errText
    out.result({ ...payload, ok: false })
    return 1
  }
  out.say(col.green(out.t('pushed', { remote: opts.remote, branch })))

  payload.pushed = { remote: opts.remote, branch }
  payload.ok = true
  payload.summary = out.t('summary')
  out.result(payload)
  return 0
}

process.exitCode = await main()
