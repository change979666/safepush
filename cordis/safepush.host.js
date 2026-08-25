/**
 * SafePush 🛡️ — Cordis/DSH dynamic plugin (Host half)
 *
 * Registers a model Tool named `safepush` that runs the SafePush CLI
 * (safepush.mjs) against a git repository: secret-scan → commit → push.
 *
 * Install (in a DSH session):
 *   1. Edit SAFE_PUSH_CLI below to the absolute path of your safepush.mjs.
 *   2. Tell your agent: 用 cordis_define 定义这个文件里的 code.host，然后 cordis_run。
 *
 * The Tool is bilingual: pass lang:"zh" or lang:"en" (default follows the CLI's auto mode).
 */

// ⚙️ EDIT ME — absolute path to safepush.mjs on this machine:
const SAFE_PUSH_CLI = 'C:/Users/Administrator/deepseek工作区/safepush/safepush.mjs'

return {
  apply(ctx) {
    const subprocess = ctx.get('subprocess')
    if (subprocess === undefined) {
      console.error('[safepush] subprocess service is not mounted on this host composition')
      return
    }

    harness.registerTool(
      harness.defineTool({
          name: 'safepush',
          description:
            'SafePush 🛡️ 安全推送 Git 仓库：先扫描暂存变更中的密钥/凭据（GitHub/OpenAI/AWS token、.env、服务账号 JSON 等，发现即阻断），再提交并推送。参数：repo_path 必填；message 提交信息；dry_run 只演示；force 忽略阻断（慎用）；lang 选 zh/en 切换输出语言。 | SafePush 🛡️ safely pushes a git repo: scans staged changes for secrets first (GitHub/OpenAI/AWS tokens, .env, service-account JSON — blocks when found), then commits and pushes. Args: repo_path required; message; dry_run preview; force override (careful); lang switches output between zh/en.',
          parameters: {
            repo_path: { type: 'string', required: true },
            message: { type: 'string' },
            dry_run: { type: 'boolean' },
            force: { type: 'boolean' },
            rebase: { type: 'boolean' },
            lang: { type: 'string' },
          },
          output: {
            schema: { type: 'object', additionalProperties: true },
            render(_args, value) {
              const ok = value && value.ok === true
              const head = ok ? '✅ SafePush' : '🛑 SafePush'
              const text = `${head}: ${value && value.headline ? value.headline : ''}\n${value && value.output ? value.output : ''}`
              return [{ type: 'text', text }]
            },
          },
          async execute(args) {
            const repoPath = String(args.repo_path || '').trim()
            if (!repoPath) return { ok: false, headline: 'repo_path is required / 必须提供 repo_path' }
            const lang = args.lang === 'zh' || args.lang === 'en' ? String(args.lang) : 'auto'

            const argv = [SAFE_PUSH_CLI]
            if (args.message) argv.push('-m', String(args.message))
            argv.push('--json')
            if (lang !== 'auto') argv.push('--lang', lang)
            if (args.dry_run === true) argv.push('--dry-run')
            if (args.force === true) argv.push('--force')
            if (args.rebase === true) argv.push('--rebase')

            let nodeExe
            try {
              nodeExe = await subprocess.resolveExecutable('node')
            } catch {
              return {
                ok: false,
                blocked: false,
                exitCode: 1,
                lang,
                repo: repoPath,
                findings: [],
                pushed: null,
                committed: null,
                headline: lang === 'zh' ? '找不到 node 可执行文件' : 'node executable not found',
                output: '',
              }
            }

            const handle = subprocess.spawn({
              argv: [nodeExe, ...argv],
              cwd: repoPath,
              stdio: {
                stdin: 'ignore',
                stdout: { maxBytes: 262144 },
                stderr: { maxBytes: 262144 },
              },
              graceMs: 10000,
            })

            const outcome = await handle.done
            let outText = ''
            let errText = ''
            try {
              outText = handle.collected.stdout ? handle.collected.stdout.readFrom(0).text : ''
            } catch {}
            try {
              errText = handle.collected.stderr ? handle.collected.stderr.readFrom(0).text : ''
            } catch {}

            let parsed = null
            try {
              parsed = JSON.parse(outText)
            } catch {}

            const exitCode = outcome.exitCode
            const blocked = exitCode === 2
            const headline =
              lang === 'zh'
                ? blocked
                  ? '发现敏感信息，已阻断提交与推送'
                  : exitCode === 0
                    ? args.dry_run === true
                      ? '预演完成，未实际改动'
                      : '提交并推送成功'
                    : '执行出错'
                : blocked
                  ? 'Secrets detected — commit & push blocked'
                  : exitCode === 0
                    ? args.dry_run === true
                      ? 'Dry-run finished, nothing changed'
                      : 'Committed and pushed successfully'
                    : 'Execution error'

            return {
              ok: exitCode === 0,
              blocked,
              exitCode,
              lang,
              repo: repoPath,
              findings: parsed && Array.isArray(parsed.findings) ? parsed.findings : [],
              pushed: parsed ? parsed.pushed : null,
              committed: parsed ? parsed.committed : null,
              headline,
              output: (outText + '\n' + errText).trim().slice(0, 8000),
            }
          },
        }),
      ),
    )
  },
}
