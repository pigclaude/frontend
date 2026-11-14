// 诊断探针（只在诊断分支）：用假网关启动随包 CLI，检查项目配置根通过 Windows 目录联接/链接指向仓库 .claude 时能否加载命令、skill、agent，以及热更新与 /命令分发；merged- 变体从子目录启动，把子目录和仓库根的 .claude 按条目合并链接。

import { execFileSync } from "node:child_process"
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { createServer } from "node:http"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const outDir = resolve(process.argv[2] ?? "test-results/junction-probe")
mkdirSync(outDir, { recursive: true })
const require = createRequire(resolve("apps/desktop/package.json"))
const sdk = await import(pathToFileURL(require.resolve("@anthropic-ai/claude-agent-sdk")).href)

function startGateway() {
  const requests = []
  let seq = 0
  const server = createServer((request, response) => {
    const chunks = []
    request.on("data", (chunk) => chunks.push(chunk))
    request.on("end", () => {
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")
      } catch {
        body = {}
      }
      const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname
      const main = path === "/v1/messages" && Array.isArray(body.tools) && body.tools.length > 0
      requests.push({ path, main, body })
      if (path === "/v1/messages/count_tokens") {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(JSON.stringify({ input_tokens: 100 }))
        return
      }
      if (path !== "/v1/messages") {
        response.writeHead(404, { "content-type": "application/json" })
        response.end(
          JSON.stringify({ type: "error", error: { type: "not_found_error", message: "probe" } }),
        )
        return
      }
      const id = `msg_probe_${++seq}`
      const text = main ? "DONE" : "OK"
      const usage = { input_tokens: 100, output_tokens: 5 }
      const message = {
        id,
        type: "message",
        role: "assistant",
        model: body.model ?? "probe",
        usage,
      }
      if (body.stream !== true) {
        response.writeHead(200, { "content-type": "application/json" })
        response.end(
          JSON.stringify({
            ...message,
            content: [{ type: "text", text }],
            stop_reason: "end_turn",
            stop_sequence: null,
          }),
        )
        return
      }
      response.writeHead(200, { "content-type": "text/event-stream" })
      const send = (event, data) =>
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      send("message_start", {
        type: "message_start",
        message: { ...message, content: [], stop_reason: null, stop_sequence: null },
      })
      send("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      })
      send("content_block_delta", {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      })
      send("content_block_stop", { type: "content_block_stop", index: 0 })
      send("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      })
      send("message_stop", { type: "message_stop" })
      response.end()
    })
  })
  return new Promise((done) =>
    server.listen(0, "127.0.0.1", () =>
      done({ server, requests, url: `http://127.0.0.1:${server.address().port}` }),
    ),
  )
}

function write(path, content) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function makeTree(variant) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "p96w-")))
  const home = join(base, "home")
  const repo = join(base, "repo")
  const sroot = join(base, "sanitized-root")
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  execFileSync("git", ["init", "-q"], { cwd: repo })
  write(join(repo, "CLAUDE.md"), "MARK_REPO_ROOT_MD\n")
  write(join(repo, ".claude", "commands", "probe-cmd.md"), "MARK_CMD_BODY $ARGUMENTS\n")
  write(
    join(repo, ".claude", "skills", "probe-skill", "SKILL.md"),
    "---\nname: probe-skill\ndescription: Probe skill. Use only when asked.\n---\n\nMARK_SKILL_BODY\n",
  )
  write(
    join(repo, ".claude", "agents", "probe-agent.md"),
    "---\nname: probe-agent\ndescription: Probe agent. Use only when asked.\n---\n\nMARK_AGENT_BODY\n",
  )
  const pkg = join(repo, "pkg")
  write(
    join(pkg, ".claude", "skills", "pkg-skill", "SKILL.md"),
    "---\nname: pkg-skill\ndescription: Pkg skill. Use only when asked.\n---\n\nMARK_PKG_SKILL\n",
  )
  write(join(pkg, ".claude", "commands", "pkg-cmd.md"), "MARK_PKG_CMD $ARGUMENTS\n")
  let linkError = null
  try {
    if (variant === "no-config-root") {
      // 对照：不设项目配置根，命令行直接读仓库的 .claude。
    } else if (variant.startsWith("merged-")) {
      for (const kind of ["commands", "skills", "agents"]) {
        mkdirSync(join(sroot, ".claude", kind), { recursive: true })
        for (const source of [pkg, repo]) {
          const dir = join(source, ".claude", kind)
          let entries = []
          try {
            entries = readdirSync(dir)
          } catch {
            continue
          }
          for (const entry of entries) {
            const from = join(dir, entry)
            const to = join(sroot, ".claude", kind, entry)
            if (statSync(from).isDirectory()) symlinkSync(from, to, "junction")
            else if (variant === "merged-hardlinks") linkSync(from, to)
            else symlinkSync(from, to, "file")
          }
        }
      }
    } else if (variant === "dotclaude-junction") {
      mkdirSync(sroot, { recursive: true })
      symlinkSync(join(repo, ".claude"), join(sroot, ".claude"), "junction")
    } else {
      mkdirSync(join(sroot, ".claude"), { recursive: true })
      const type = variant === "child-dir-symlinks" ? "dir" : "junction"
      for (const name of ["commands", "skills", "agents"]) {
        symlinkSync(join(repo, ".claude", name), join(sroot, ".claude", name), type)
      }
    }
  } catch (error) {
    linkError = String(error)
  }
  return { base, home, repo, pkg, sroot, linkError }
}

function visible(request) {
  return request
    ? JSON.stringify({ system: request.body.system, messages: request.body.messages })
    : ""
}

async function runVariant(variant) {
  const tree = makeTree(variant)
  if (tree.linkError !== null) {
    rmSync(tree.base, { recursive: true, force: true })
    return { variant, linkError: tree.linkError }
  }
  const gw = await startGateway()
  const queue = []
  let wake = null
  let ended = false
  async function* prompt() {
    while (true) {
      while (queue.length === 0 && !ended) await new Promise((done) => (wake = done))
      if (queue.length === 0) return
      yield queue.shift()
    }
  }
  const push = (text) => {
    queue.push({
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: "",
    })
    wake?.()
  }
  const env = { ...process.env }
  delete env.ANTHROPIC_API_KEY
  Object.assign(env, {
    ANTHROPIC_BASE_URL: gw.url,
    ANTHROPIC_AUTH_TOKEN: "probe-token",
    CLAUDE_CONFIG_DIR: join(tree.base, "config"),
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
    HOME: tree.home,
    USERPROFILE: tree.home,
  })
  const messages = []
  const listeners = new Set()
  const stderr = []
  const query = sdk.query({
    prompt: prompt(),
    options: {
      cwd: variant.startsWith("merged-") ? tree.pkg : tree.repo,
      env,
      model: "claude-sonnet-4-5",
      settingSources: ["project"],
      ...(variant === "no-config-root" ? {} : { projectConfigRoot: tree.sroot }),
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      persistSession: false,
      stderr: (line) => stderr.push(line),
    },
  })
  const pump = (async () => {
    try {
      for await (const message of query) {
        messages.push(message)
        for (const listener of listeners) listener(message)
      }
    } catch (error) {
      messages.push({ type: "probe_error", error: String(error) })
    }
  })()
  const turn = (text) =>
    new Promise((done) => {
      const from = gw.requests.length
      const timer = setTimeout(() => finish(false), 120_000)
      const listener = (message) => {
        if (message.type === "result") finish(true)
      }
      function finish(ok) {
        clearTimeout(timer)
        listeners.delete(listener)
        done({ ok, main: gw.requests.slice(from).find((request) => request.main) })
      }
      listeners.add(listener)
      push(text)
    })
  const lastInit = () =>
    messages.filter((message) => message.type === "system" && message.subtype === "init").at(-1)
  const t1 = await turn("hello")
  const init1 = lastInit()
  const before = messages.length
  write(
    join(tree.repo, ".claude", "skills", "hot-skill", "SKILL.md"),
    "---\nname: hot-skill\ndescription: Hot skill. Use only when asked.\n---\n\nMARK_HOT_SKILL\n",
  )
  write(join(tree.repo, ".claude", "commands", "hot-cmd.md"), "MARK_HOT_CMD $ARGUMENTS\n")
  await new Promise((done) => setTimeout(done, 5_000))
  const changedBeforeTurn = messages
    .slice(before)
    .filter((message) => message.subtype === "commands_changed").length
  const t2 = await turn("/probe-cmd ARG_X")
  const t3 = await turn("/hot-cmd ARG_Y")
  const t4 = variant.startsWith("merged-") ? await turn("/pkg-cmd ARG_Z") : null
  const init3 = lastInit()
  ended = true
  wake?.()
  try {
    query.close()
  } catch {
    // 已退出。
  }
  await Promise.race([pump, new Promise((done) => setTimeout(done, 10_000))])
  gw.server.closeAllConnections()
  gw.server.close()
  const names = (list) =>
    Array.isArray(list) ? list.map((item) => (typeof item === "string" ? item : item?.name)) : list
  const pick = (list, wanted) =>
    (names(list) ?? []).filter((name) => wanted.some((w) => String(name).includes(w)))
  const result = {
    variant,
    turnsCompleted: [t1.ok, t2.ok, t3.ok],
    mainRequests: gw.requests.filter((request) => request.main).length,
    claudeMdFromCwd: visible(t1.main).includes("MARK_REPO_ROOT_MD"),
    init1: {
      slash_commands: pick(init1?.slash_commands, ["probe-", "hot-", "pkg-"]),
      skills: pick(init1?.skills, ["probe-", "hot-", "pkg-"]),
      agents: pick(init1?.agents, ["probe-"]),
    },
    commandsChangedBeforeNextTurn: changedBeforeTurn,
    commandsChangedTotal: messages.filter((message) => message.subtype === "commands_changed")
      .length,
    probeCmdDispatched: visible(t2.main).includes("MARK_CMD_BODY ARG_X"),
    hotCmdDispatched: visible(t3.main).includes("MARK_HOT_CMD ARG_Y"),
    pkgCmdDispatched: t4 === null ? null : visible(t4.main).includes("MARK_PKG_CMD ARG_Z"),
    init3: {
      slash_commands: pick(init3?.slash_commands, ["probe-", "hot-", "pkg-"]),
      skills: pick(init3?.skills, ["probe-", "hot-", "pkg-"]),
    },
    errors: messages.filter((message) => message.type === "probe_error"),
    stderrTail: stderr.slice(-5).map((line) => line.replaceAll(tree.base, "<base>").slice(0, 300)),
  }
  rmSync(tree.base, { recursive: true, force: true, maxRetries: 5 })
  return result
}

const results = []
const variants = [
  "child-junctions",
  "dotclaude-junction",
  "child-dir-symlinks",
  "merged-hardlinks",
  "merged-file-symlinks",
  "no-config-root",
]
for (const variant of process.env.PROBE_VARIANTS?.split(",") ?? variants) {
  results.push(await runVariant(variant))
  console.log(JSON.stringify(results.at(-1), null, 2))
}
writeFileSync(join(outDir, `results-${process.platform}.json`), JSON.stringify(results, null, 2))
process.exit(0)
