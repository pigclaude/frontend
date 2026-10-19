// 负责 OAuth/OIDC 专用本地设施、受限环境及自有 loopback 子进程的完整生命周期。
import { readFile, lstat } from "node:fs/promises"
import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"
import { allocateLoopbackPort } from "./phase1-local-launcher.mjs"

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)))
/** 拒绝缺设施、非loopback、非专用库和无随机隔离标识的启动。 */
export function validateOAuthInfrastructure(env) {
  if (!env.DATABASE_URL || !env.REDIS_URL || !env.OAUTH_TEST_OWNER)
    throw new Error("OAUTH_TEST_INFRA_REQUIRED")
  const parse = (value, protocols) => {
    let url
    try {
      url = new URL(value)
    } catch {
      throw new Error("OAUTH_TEST_INFRA_INVALID")
    }
    if (
      !protocols.includes(url.protocol) ||
      url.hostname !== "127.0.0.1" ||
      !url.port ||
      url.search ||
      url.hash
    )
      throw new Error("OAUTH_TEST_INFRA_INVALID")
    return url
  }
  const pg = parse(env.DATABASE_URL, ["postgres:", "postgresql:"])
  parse(env.REDIS_URL, ["redis:"])
  if (
    !/^\/pigclaude_oauth_test_[a-f0-9]+$/.test(pg.pathname) ||
    !/^oauth-oidc:[a-f0-9]{8,}:$/.test(env.OAUTH_TEST_OWNER)
  )
    throw new Error("OAUTH_TEST_OWNERSHIP_INVALID")
  if (env.PIGCLAUDE_SETTINGS_TEST_DATABASE_URL !== env.DATABASE_URL)
    throw new Error("OAUTH_TEST_DATABASE_MISMATCH")
  return { owner: env.OAUTH_TEST_OWNER }
}
/** 只把启动web所需的非秘密环境传给Next/Vite，禁止继承设施URL及用户令牌。 */
export function publicWebEnvironment(env, api, home) {
  const result = {
    PATH: env.PATH,
    HOME: env.HOME,
    TMPDIR: env.TMPDIR,
    NODE_ENV: "development",
    NEXT_TELEMETRY_DISABLED: "1",
    API_PROXY_TARGET: api,
    PIGCLAUDE_HOME_URL: home,
  }
  return Object.fromEntries(Object.entries(result).filter(([, value]) => typeof value === "string"))
}
function start(command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  })
  child.once("error", () => undefined)
  child.stderr.resume()
  // 框架日志可能含URL/表单，本launcher完全不转发原始子进程输出。
  return child
}
async function close(child, graceful = false) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((done) => child.once("exit", done))
  if (graceful) child.stdin.end()
  else {
    try {
      process.kill(-child.pid, "SIGTERM")
    } catch {
      child.kill("SIGTERM")
    }
  }
  const timer = setTimeout(() => {
    try {
      process.kill(-child.pid, "SIGKILL")
    } catch {
      child.kill("SIGKILL")
    }
  }, 5000)
  await exited
  clearTimeout(timer)
  if (graceful && child.exitCode !== 0) throw new Error("OAUTH_TEST_FIXTURE_CLEANUP_FAILED")
}
async function healthy(url, child) {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("OAUTH_TEST_CHILD_EXITED")
    try {
      if (
        (await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(1500) })).status < 400
      )
        return
    } catch {
      /* 启动中的本例服务尚未ready。 */
    }
    await new Promise((done) => setTimeout(done, 100))
  }
  throw new Error("OAUTH_TEST_READY_TIMEOUT")
}
/** 启动测试专用Rust example和实际Next/Vite；退出只清理本launcher创建的进程与schema。 */
export async function startOAuthLauncher(env = process.env) {
  validateOAuthInfrastructure(env)
  if (!env.OAUTH_TEST_INFRA_FILE) throw new Error("OAUTH_TEST_METADATA_REQUIRED")
  let metadata
  try {
    metadata = JSON.parse(await readFile(env.OAUTH_TEST_INFRA_FILE, "utf8"))
  } catch {
    throw new Error("OAUTH_TEST_METADATA_INVALID")
  }
  const pg = new URL(env.DATABASE_URL)
  const redis = new URL(env.REDIS_URL)
  if (
    metadata.owner !== "oauth-oidc" ||
    metadata.workspace !== root ||
    metadata.host !== "127.0.0.1" ||
    metadata.namespace !== env.OAUTH_TEST_OWNER ||
    metadata.postgres_port !== pg.port ||
    metadata.redis_port !== redis.port ||
    metadata.postgres_database !== pg.pathname.slice(1) ||
    metadata.postgres_role !== decodeURIComponent(pg.username)
  )
    throw new Error("OAUTH_TEST_METADATA_MISMATCH")
  const privateFile = await lstat(metadata.private_env_file)
  if (!privateFile.isFile() || privateFile.isSymbolicLink() || (privateFile.mode & 0o777) !== 0o600)
    throw new Error("OAUTH_TEST_PRIVATE_FILE_INVALID")
  const home = `http://127.0.0.1:${await allocateLoopbackPort()}`
  const admin = `http://127.0.0.1:${await allocateLoopbackPort()}`
  const secret = randomBytes(32).toString("hex")
  const children = []
  let fixture
  const shutdown = async () => {
    for (const child of [...children].reverse()) await close(child, child === fixture)
  }
  try {
    fixture = start(resolve(root, "backend/target/debug/examples/oauth-live-fixture"), [], {
      PATH: env.PATH,
      HOME: env.HOME,
      TMPDIR: env.TMPDIR,
      DATABASE_URL: env.DATABASE_URL,
      REDIS_URL: env.REDIS_URL,
      PIGCLAUDE_SETTINGS_TEST_DATABASE_URL: env.PIGCLAUDE_SETTINGS_TEST_DATABASE_URL,
      OAUTH_TEST_INFRA_FILE: env.OAUTH_TEST_INFRA_FILE,
      OAUTH_TEST_HOME: home,
      OAUTH_TEST_ADMIN: admin,
      OAUTH_TEST_CONTROL_SECRET: secret,
    })
    children.push(fixture)
    const ports = await new Promise((done, reject) => {
      let buffer = ""
      const timer = setTimeout(() => reject(new Error("OAUTH_TEST_FIXTURE_TIMEOUT")), 30000)
      fixture.once("error", () => {
        clearTimeout(timer)
        reject(new Error("OAUTH_TEST_FIXTURE_START_FAILED"))
      })
      fixture.once("exit", () => {
        clearTimeout(timer)
        reject(new Error("OAUTH_TEST_FIXTURE_EXITED"))
      })
      fixture.stdout.on("data", (chunk) => {
        buffer += chunk.toString()
        const at = buffer.indexOf("\n")
        if (at < 0) return
        try {
          const value = JSON.parse(buffer.slice(0, at))
          if (value.ready === true) {
            clearTimeout(timer)
            done(value)
          }
        } catch {
          reject(new Error("OAUTH_TEST_FIXTURE_PROTOCOL"))
        }
      })
    })
    fixture.stdout.resume()
    const homeChild = start(
      "pnpm",
      [
        "--dir",
        "frontend/apps/home",
        "exec",
        "next",
        "dev",
        "--hostname",
        "127.0.0.1",
        "--port",
        new URL(home).port,
      ],
      publicWebEnvironment(env, ports.api, home),
    )
    const adminChild = start(
      "pnpm",
      [
        "--dir",
        "frontend/apps/admin",
        "exec",
        "vite",
        "--host",
        "127.0.0.1",
        "--port",
        new URL(admin).port,
        "--strictPort",
      ],
      publicWebEnvironment(env, ports.api2, home),
    )
    children.push(homeChild, adminChild)
    homeChild.stdout.resume()
    adminChild.stdout.resume()
    await Promise.all([
      healthy(`${home}/v1/auth/captcha`, homeChild),
      healthy(`${admin}/login`, adminChild),
    ])
    return {
      home,
      admin,
      control: ports.control,
      secret,
      shutdown,
      pids: children.map((child) => child.pid),
    }
  } catch {
    await shutdown()
    throw new Error("OAUTH_TEST_LAUNCH_FAILED")
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const launcher = await startOAuthLauncher()
    console.log(
      JSON.stringify({
        ready: true,
        homePort: new URL(launcher.home).port,
        adminPort: new URL(launcher.admin).port,
      }),
    )
    const shutdown = async () => {
      await launcher.shutdown()
      process.exit(0)
    }
    process.once("SIGTERM", shutdown)
    process.once("SIGINT", shutdown)
  } catch {
    console.error("OAUTH_TEST_LAUNCH_FAILED")
    process.exitCode = 1
  }
}
