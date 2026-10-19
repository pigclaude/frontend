// 负责运行真实本地launcher与隔离子进程，验证验证码Secret只交给Rust而不进入web进程。
import assert from "node:assert/strict"
import test from "node:test"
import { mkdtemp, writeFile, chmod, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { allocateLoopbackPort, startPhaseOneLauncher } from "../scripts/phase1-local-launcher.mjs"

test("Turnstile secret reaches Rust but not home/admin child environments", async () => {
  const fixture = await mkdtemp(join(tmpdir(), "pigclaude-turnstile-launcher-"))
  const program = `#!/usr/bin/env node
// 此临时夹具只记录环境边界并响应launcher健康探测，不连接任何业务服务。
const fs = require("node:fs")
const path = require("node:path")
const http = require("node:http")
const args = process.argv.slice(2)
const rust = path.basename(process.argv[1]) === "cargo"
const name = rust ? "rust" : args.includes("frontend/apps/home") ? "home" : "admin"
const port = rust
  ? Number(process.env.PIGCLAUDE_SERVER_ADDR.split(":").at(-1))
  : Number(args[args.indexOf("--port") + 1])
fs.writeFileSync(path.join(path.dirname(process.argv[1]), name + ".json"), JSON.stringify({
  secretPresent: Object.hasOwn(process.env, "PIGCLAUDE_TURNSTILE_SECRET_KEY"),
  publicSiteKey: process.env.PIGCLAUDE_TURNSTILE_SITE_KEY,
  privatePresent: ["DATABASE_URL", "REDIS_URL", "PIGCLAUDE_OAUTH_CONFIG_FILE", "PIGCLAUDE_AUTH_KEY_FILE", "PROVIDER_SECRET"].some((key) => key in process.env),
}))
const server = http.createServer((_request, response) => response.end("ok"))
server.listen(port, "127.0.0.1")
process.on("SIGTERM", () => server.close(() => process.exit(0)))
`
  for (const executable of ["cargo", "pnpm"]) {
    const file = join(fixture, executable)
    await writeFile(file, program)
    await chmod(file, 0o700)
  }
  const homePort = await allocateLoopbackPort()
  const adminPort = await allocateLoopbackPort()
  const configFile = join(fixture, "oauth.json")
  const resetFile = join(fixture, "reset.json")
  const ownership = "pigclaude:reset:" + "a".repeat(32)
  await writeFile(
    configFile,
    JSON.stringify({
      issuer: `http://127.0.0.1:${homePort}`,
      home_origin: `http://127.0.0.1:${homePort}`,
      admin_origin: `http://127.0.0.1:${adminPort}`,
    }),
    { mode: 0o600 },
  )
  await writeFile(
    resetFile,
    JSON.stringify({
      project: "pigclaude",
      dedicated: true,
      ownership,
      redisNamespace: ownership + ":",
    }),
    { mode: 0o600 },
  )
  let launcher
  try {
    launcher = await startPhaseOneLauncher({
      PATH: `${fixture}:${process.env.PATH ?? ""}`,
      PIGCLAUDE_OAUTH_CONFIG_FILE: configFile,
      PIGCLAUDE_RESET_MANIFEST_FILE: resetFile,
      PIGCLAUDE_AUTH_REDIS_NAMESPACE: ownership,
      PIGCLAUDE_AUTH_KEY_FILE: "/private/auth.key",
      PROVIDER_SECRET: "private-provider-marker",
      PIGCLAUDE_TURNSTILE_MODE: "testing",
      PIGCLAUDE_TURNSTILE_SITE_KEY: "public-test-site",
      PIGCLAUDE_TURNSTILE_SECRET_KEY: "private-test-marker",
    })
    const probes = {}
    for (const name of ["rust", "home", "admin"]) {
      probes[name] = JSON.parse(await readFile(join(fixture, `${name}.json`), "utf8"))
    }
    assert.equal(probes.rust.secretPresent, true)
    assert.equal(probes.home.secretPresent, false)
    assert.equal(probes.admin.secretPresent, false)
    assert.equal(probes.home.publicSiteKey, undefined)
    assert.equal(probes.home.privatePresent, false)
    assert.equal(probes.admin.publicSiteKey, undefined)
    assert.equal(probes.admin.privatePresent, false)
  } finally {
    if (launcher) await launcher.shutdown()
    await rm(fixture, { recursive: true, force: true })
  }
})
