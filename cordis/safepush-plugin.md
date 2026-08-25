# SafePush Cordis/DSH 插件 🧩

**简体中文** | [English](#english)

把 SafePush 注册成 DSH 的模型 Tool，Agent 在对话里就能安全推送 Git 仓库。

---

## 中文

### 它做什么

在 DSH 会话里注册一个名为 `safepush` 的 Tool：

- Agent 调用 `safepush({ repo_path, message, lang, dry_run, force })`
- 插件通过 Host 的 `subprocess` 服务执行 SafePush CLI（`safepush.mjs`）
- 返回结构化 JSON：是否成功、密钥扫描发现、提交/推送结果
- **中英切换**：`lang: "zh"` 或 `"en"`，不传则跟随系统语言

### 安装步骤

1. 把本项目 clone 到本机（或只下载 `safepush.mjs`）。
2. 打开 [safepush.host.js](./safepush.host.js)，修改顶部常量：

   ```js
   const SAFE_PUSH_CLI = '你的/safepush.mjs/绝对路径'
   ```

3. 在 DSH 会话里对 Agent 说：

   > 用 cordis_define 定义 `C:\...\safepush\cordis\safepush.host.js` 里的 code.host（作为新插件），然后 cordis_run 运行它

4. 运行成功后直接试：

   > 用 safepush 工具预演推送 `D:\my-project`（dry_run）

### 安全说明

- 插件只做一件事：用 node 执行你指定路径的 `safepush.mjs`，不做其他任何事
- 密钥扫描在本地完成，任何内容都不会上传
- 阻断级发现默认拒绝推送；`force: true` 可越过（风险自负）

### 源码

完整插件源码见 [safepush.host.js](./safepush.host.js)（约 150 行，无依赖）。核心逻辑：

```js
const handle = subprocess.spawn({
  argv: [nodeExe, SAFE_PUSH_CLI, repoPath, '-m', message, '--json', '--lang', lang],
  cwd: repoPath,
  stdio: { stdin: 'ignore', stdout: { maxBytes: 262144 }, stderr: { maxBytes: 262144 } },
  graceMs: 10000,
})
const outcome = await handle.done
// exitCode === 2 ⇒ 密钥阻断；0 ⇒ 成功
```

---

<a id="english"></a>

## English

### What it does

Registers a model Tool named `safepush` in a DSH session:

- The agent calls `safepush({ repo_path, message, lang, dry_run, force })`
- The plugin runs the SafePush CLI (`safepush.mjs`) through the Host `subprocess` service
- It returns structured JSON: success flag, secret-scan findings, commit/push result
- **Language switching**: pass `lang: "zh"` or `"en"`; omit to follow system locale

### Setup

1. Clone this project (or just download `safepush.mjs`).
2. Open [safepush.host.js](./safepush.host.js) and edit the constant at the top:

   ```js
   const SAFE_PUSH_CLI = 'absolute/path/to/your/safepush.mjs'
   ```

3. In a DSH session, tell your agent:

   > Define the code.host from `C:\...\safepush\cordis\safepush.host.js` as a new plugin with cordis_define, then run it with cordis_run

4. Once running, try:

   > Use the safepush tool to dry-run push `D:\my-project`

### Security notes

- The plugin does exactly one thing: execute your local `safepush.mjs` with node. Nothing else.
- Secret scanning happens locally; nothing is uploaded anywhere.
- Blocking findings refuse the push by default; `force: true` overrides (at your own risk).

### Source

Full plugin source: [safepush.host.js](./safepush.host.js) (~150 lines, zero dependencies). Core logic:

```js
const handle = subprocess.spawn({
  argv: [nodeExe, SAFE_PUSH_CLI, repoPath, '-m', message, '--json', '--lang', lang],
  cwd: repoPath,
  stdio: { stdin: 'ignore', stdout: { maxBytes: 262144 }, stderr: { maxBytes: 262144 } },
  graceMs: 10000,
})
const outcome = await handle.done
// exitCode === 2 ⇒ blocked by secrets; 0 ⇒ success
```
