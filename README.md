# SafePush 🛡️

**简体中文** | [English](#english)

> AI 友好的 Git 安全推送工具：提交前自动扫描密钥，别让 `.env` 和 API Key 跟着代码一起飞到远程仓库。

[![Node](https://img.shields.io/badge/node-%E2%89%A516-blue)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![Zero deps](https://img.shields.io/badge/dependencies-0-brightgreen)](#)

---

## 这是什么

AI 编码助手（Claude Code、Cursor、DSH/Cordis Agent 等）写代码越来越快，但「改完顺手一推」也把事故推了上去：`.env`、服务账号 JSON、硬编码在配置里的 API Key……一旦进了 git 历史，再删除也已经泄漏。

SafePush 是一个**零依赖的单文件 CLI**，插在 `git add` 与 `git push` 之间：

```
status → add -A → 🔍 密钥扫描 → commit → push
                        │
                        └─ 阻断级发现 → 拒绝提交推送（exit 2）
```

它不是理论安全工具——每一类规则都来自真实事故场景（GitHub PAT 嵌在 remote URL、`gsc-service-account.json` 躺在项目根目录、`.dev.vars` 差点进暂存区……）。

## 特性

- 🛡️ **两级密钥扫描**：阻断级（明确的 token 格式、密钥文件名）直接拦截；警告级（JWT、URL 内嵌凭据、`password = "…"` 赋值）提示后放行
- 🌏 **中英双语输出**：`--lang zh|en|auto`，auto 按 shell 的 LANG 环境自动切换
- 🤖 **Agent 优先设计**：`--json` 输出结构化结果、`--dry-run` 只看不推、退出码语义化（0 成功 / 1 错误 / 2 密钥阻断），方便任何 AI Agent 直接消费
- 📦 **零依赖单文件**：一个 `safepush.mjs` 走天下，Node ≥ 16 即可，不用装任何包
- 🧩 **Cordis/DSH 插件版**：见 [cordis/safepush-plugin.md](./cordis/safepush-plugin.md)，注册成模型 Tool 后 Agent 在对话里就能安全推送

## 快速开始

```bash
# 最常用：扫一遍 → 提交 → 推送当前分支
node safepush.mjs . -m "feat: add login page"

# 只看会发生什么，不动仓库
node safepush.mjs . --dry-run --lang zh

# 机器可读结果（给 Agent / CI 用）
node safepush.mjs . -m "fix" --json

# 远程有新提交时自动变基后再推
node safepush.mjs . --rebase
```

## 参数一览

| 参数 | 说明 |
| --- | --- |
| `[repoPath]` | 目标仓库路径，默认当前目录 |
| `-m <msg>` | 提交信息（缺省生成带时间戳的 chore 信息） |
| `--remote <name>` | 远程名，默认 `origin` |
| `--branch <name>` | 分支名，默认当前分支 |
| `--dry-run` | 只展示将要执行的操作 |
| `--lang zh\|en\|auto` | 输出语言；`auto` 依据 LANG 环境变量 |
| `--strict` | 警告级发现也视为阻断 |
| `--force` | 忽略阻断级发现继续推送（风险自负） |
| `--rebase` | 推送前检测落后并自动 `pull --rebase` |
| `--json` | 输出 JSON 结果 |
| `--no-color` | 关闭彩色输出 |

## 安全模型

**阻断级内容规则**（发现即拒绝，除非 `--force`）：

GitHub 经典/Fine-grained token · OpenRouter `sk-or-v1-*` · OpenAI 风格 `sk-*` · AWS `AKIA*` · PEM 私钥块 · Google service-account JSON · Slack `xox*-`

**阻断级文件规则**：`.env` / `.env.*`（example/sample 除外）· `.dev.vars` · `*service-account*.json` · `.pem/.key/id_rsa/id_ed25519` 等 · `credentials*.json`

**警告级内容规则**：URL 内嵌凭据（`https://user:token@host`）· JWT · `api_key = "…"` 类硬编码赋值

所有匹配输出都会**脱敏**（只显示前 6 位 + `***`），日志里不会二次泄漏。

**退出码**：`0` 成功 · `1` 运行错误 · `2` 密钥阻断

## 作为 DSH / Cordis 插件使用

如果你在用 [DeepSeek Harness (DSH)](https://github.com/dataelement/dsh-desktop)，可以直接把 SafePush 注册成模型 Tool，Agent 在对话里即可安全推送。完整源码与安装步骤见 [cordis/safepush-plugin.md](./cordis/safepush-plugin.md)。

## FAQ

**Q: 会误报吗？**
会偶尔出现警告级误报（比如文档里的示例赋值）。警告级默认放行；阻断级格式规则（真实 token 形状）误报率极低，确认误报可加 `--force`。

**Q: 能替代 pre-commit hook 吗？**
可以共存。把扫描放在推送前而不是提交前，能保留「本地快速试错」的体验；要更严格可在 husky 里调用本工具的扫描模式。

**Q: 为什么是单文件？**
方便 AI Agent 一行命令拉取即用，也方便你读完这 400 行就知道它对你的仓库做了什么。安全工具应该可以被审计。

## License

[MIT](./LICENSE) © 2026 change979666

---

<a id="english"></a>

## English

> AI-friendly safe git push: scans for secrets before committing, so your `.env` and API keys never fly to the remote along with your code.

### What is this

AI coding assistants (Claude Code, Cursor, DSH/Cordis agents…) ship features faster than ever — and sometimes ship accidents too: `.env`, service-account JSONs, hardcoded API keys. Once they enter git history, deleting them doesn't un-leak them.

SafePush is a **zero-dependency single-file CLI** sitting between `git add` and `git push`:

```
status → add -A → 🔍 secret scan → commit → push
                        │
                        └─ blocking findings → refuse to commit/push (exit 2)
```

Every rule here comes from real-world incidents (a GitHub PAT embedded in a remote URL, a `gsc-service-account.json` sitting in the project root, a `.dev.vars` one step away from being staged…).

### Features

- 🛡️ **Two-tier secret scanning**: blocking tier (definite token formats, credential filenames) refuses to proceed; warning tier (JWTs, credentials in URLs, `password = "…"` assignments) warns then continues
- 🌏 **Bilingual output**: `--lang zh|en|auto`; auto detects from your shell's LANG
- 🤖 **Agent-first design**: `--json` structured results, `--dry-run`, semantic exit codes (0 ok / 1 error / 2 blocked by secrets) — easy for any AI agent to consume
- 📦 **Single file, zero deps**: just Node ≥ 16, nothing to install
- 🧩 **Cordis/DSH plugin edition**: see [cordis/safepush-plugin.md](./cordis/safepush-plugin.md); register it as a model Tool so agents can safe-push right from the chat

### Quick start

```bash
# most common: scan → commit → push current branch
node safepush.mjs . -m "feat: add login page"

# preview only, touch nothing
node safepush.mjs . --dry-run --lang en

# machine-readable result (for agents / CI)
node safepush.mjs . -m "fix" --json

# auto-rebase when behind, then push
node safepush.mjs . --rebase
```

### Options

| Option | Description |
| --- | --- |
| `[repoPath]` | target repo path, defaults to cwd |
| `-m <msg>` | commit message (timestamped default if omitted) |
| `--remote <name>` | remote name, default `origin` |
| `--branch <name>` | branch name, defaults to current |
| `--dry-run` | show what would happen, do nothing |
| `--lang zh\|en\|auto` | output language; auto follows LANG env |
| `--strict` | warning-level findings also block |
| `--force` | override blocking findings (at your own risk) |
| `--rebase` | detect behind-remote and auto `pull --rebase` before push |
| `--json` | print JSON result |
| `--no-color` | disable colors |

### Safety model

**Blocking content rules** (refuse unless `--force`):

GitHub classic/fine-grained tokens · OpenRouter `sk-or-v1-*` · OpenAI-style `sk-*` · AWS `AKIA*` · PEM private key blocks · Google service-account JSON · Slack `xox*-`

**Blocking file rules**: `.env` / `.env.*` (except example/sample) · `.dev.vars` · `*service-account*.json` · `.pem/.key/id_rsa/id_ed25519` etc. · `credentials*.json`

**Warning content rules**: credentials embedded in URLs (`https://user:token@host`) · JWTs · hardcoded `api_key = "…"` style assignments

Every reported match is **masked** (first 6 chars + `***`) so logs never leak twice.

**Exit codes**: `0` ok · `1` runtime error · `2` blocked by secrets

### Use as a DSH / Cordis plugin

On the [DeepSeek Harness (DSH)](https://github.com/dataelement/dsh-desktop), register SafePush as a model Tool and let your agent safe-push from the conversation. Full source and setup: [cordis/safepush-plugin.md](./cordis/safepush-plugin.md).

### FAQ

**Q: False positives?**
Warning-tier rules occasionally fire on doc examples; they don't block by default. Blocking-tier format rules (real token shapes) rarely misfire; use `--force` when confirmed false positive.

**Q: Replace pre-commit hooks?**
They coexist fine. Scanning at push time keeps local iteration fast; wire this tool into husky for stricter setups.

**Q: Why single-file?**
One command for any agent to fetch and run — and ~400 lines you can actually read before trusting it with your repo. Security tools should be auditable.

### License

[MIT](./LICENSE) © 2026 change979666
