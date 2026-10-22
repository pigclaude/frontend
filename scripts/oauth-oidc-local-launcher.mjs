// 负责 OAuth/OIDC 专用本地设施、受限环境及自有 loopback 子进程的完整生命周期。
import { readFile, lstat } from "node:fs/promises"
import { createOAuthLifecycle } from "./oauth-oidc-process-lifecycle.mjs"
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
function start(lifecycle, command, args, env, role) {
  const child = lifecycle.spawn(
    command,
    args,
    {
      cwd: root,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    },
    role,
  )
  child.stderr.resume()
  return child
}
async function healthy(url, child, lifecycle) {
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    lifecycle.throwIfCancelled()
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("OAUTH_TEST_CHILD_EXITED")
    try {
      if (
        (
          await fetch(url, {
            redirect: "manual",
            signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(1500)]),
          })
        ).status < 400
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
export async function startOAuthLauncher(env = process.env, owner) {
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
  const lifecycle = owner ?? createOAuthLifecycle()
  const children = []
  const shutdown = async () => {
    try {
      await lifecycle.shutdown()
    } finally {
      if (!owner) lifecycle.dispose()
    }
  }
  let fixture
  try {
    fixture = start(
      lifecycle,
      resolve(root, "backend/target/debug/examples/oauth-live-fixture"),
      [],
      {
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
      },
      "fixture",
    )
    children.push(fixture)
    const ports = await lifecycle.pending(
      new Promise((done, reject) => {
        let buffer = ""
        const timer = setTimeout(() => reject(new Error("OAUTH_TEST_FIXTURE_TIMEOUT")), 30000)
        lifecycle.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer)
            reject(new Error("OAUTH_TEST_CANCELLED"))
          },
          { once: true },
        )
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
            clearTimeout(timer)
            reject(new Error("OAUTH_TEST_FIXTURE_PROTOCOL"))
          }
        })
      }),
    )
    fixture.stdout.resume()
    const homeChild = start(
      lifecycle,
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
    children.push(homeChild)
    const adminChild = start(
      lifecycle,
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
    children.push(adminChild)
    homeChild.stdout.resume()
    adminChild.stdout.resume()
    await lifecycle.pending(
      Promise.all([
        healthy(`${home}/v1/auth/captcha`, homeChild, lifecycle),
        healthy(`${admin}/login`, adminChild, lifecycle),
      ]),
    )
    return {
      home,
      admin,
      control: ports.control,
      api: ports.api,
      api2: ports.api2,
      schema: ports.schema,
      database: ports.database,
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
  const lifecycle = createOAuthLifecycle()
  try {
    const launcher = await startOAuthLauncher(process.env, lifecycle)
    console.log(
      JSON.stringify({
        ready: true,
        homePort: new URL(launcher.home).port,
        adminPort: new URL(launcher.admin).port,
      }),
    )
    await lifecycle.pending(lifecycle.cancellation)
  } catch {
    if (!lifecycle.cancelledBySignal) {
      console.error("OAUTH_TEST_LAUNCH_FAILED")
      process.exitCode = 1
    }
  } finally {
    try {
      await lifecycle.shutdown()
      console.log("OWNED_PROCESSES_STOPPED")
    } catch {
      console.error("OAUTH_TEST_CLEANUP_FAILED")
      process.exitCode = 1
    }
    lifecycle.dispose()
  }
}
