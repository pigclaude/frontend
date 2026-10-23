// 负责本轮会员验收的独占栈、网关和浏览器能力；秘密仅写入0600私有运行文件。
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { randomBytes, createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { startOAuthLauncher } from "./oauth-oidc-local-launcher.mjs"
import { createOAuthLifecycle } from "./oauth-oidc-process-lifecycle.mjs"
import { startOwnedOAuthBrowser } from "./oauth-oidc-browser-owner.mjs"
import { startFakeEpayGateway } from "./fake-epay-gateway.mjs"
const root = resolve(import.meta.dirname, "../..")
const plan = resolve(root, ".superpowers/sdd/2026-10-23-pigclaude-membership-experience")
const owner = createOAuthLifecycle()
let gateway
try {
  const runId = `t15-${Date.now()}-${randomBytes(4).toString("hex")}`
  const evidence = resolve(root, "docs/verification/assets/2026-10-23-membership-experience", runId)
  await mkdir(evidence, { recursive: true })
  const launcher = await startOAuthLauncher(process.env, owner)
  const gatewayPid = randomBytes(8).toString("hex")
  const gatewayKey = randomBytes(32).toString("hex")
  gateway = await startFakeEpayGateway({
    host: "127.0.0.1",
    pid: gatewayPid,
    key: gatewayKey,
    ownedOrigins: [launcher.home],
  })
  const browser = await startOwnedOAuthBrowser(owner)
  const source = Object.fromEntries(
    [".", "frontend", "backend", "docs"].map((repo) => [
      repo,
      execFileSync("git", ["-C", resolve(root, repo), "rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
    ]),
  )
  const runtime = {
    ...launcher,
    shutdown: undefined,
    runId,
    owner: "2026-10-23-membership-experience",
    gateway: gateway.origin,
    gatewayPid,
    gatewayKey,
    browserWs: browser.endpoint,
    postgresContainer: "pigclaude-experience-pg",
    evidence,
  }
  await writeFile(resolve(plan, "task-15-runtime.private.json"), JSON.stringify(runtime), {
    mode: 0o600,
  })
  await writeFile(
    resolve(evidence, "runtime-identity.json"),
    JSON.stringify(
      {
        runId,
        source,
        startedAt: new Date().toISOString(),
        home: launcher.home,
        admin: launcher.admin,
        api: launcher.api,
        api2: launcher.api2,
        schema: launcher.schema,
        database: launcher.database,
        pids: launcher.pids,
        holderPid: process.pid,
        browserPid: browser.process.pid,
        gateway: gateway.origin,
        binarySha256: createHash("sha256")
          .update(await readFile(resolve(root, "backend/target/debug/examples/oauth-live-fixture")))
          .digest("hex"),
        lifecycle: "active; owned temporary fixture cleanup authorized F25",
      },
      null,
      2,
    ),
  )
  console.log(JSON.stringify({ ready: true, runId, evidence }))
  await owner.pending(owner.cancellation)
} catch {
  if (!owner.cancelledBySignal) {
    console.error("MEMBERSHIP_HOLDER_FAILED")
    process.exitCode = 1
  }
} finally {
  await gateway?.close()
  await owner.shutdown()
  owner.dispose()
}
