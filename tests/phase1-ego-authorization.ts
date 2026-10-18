// 负责把内存授权 URL 经 stdin 委托给已有 Ego 空间；只返回有限安全状态。
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { requireProductionDesktopGate } from "./phase1-production-desktop-support"

const statuses = [
  "ready-for-approval",
  "login-required",
  "human-required",
  "unavailable",
  "authorized",
  "cleanup-unconfirmed",
] as const
/** 委托只返回安全枚举，不返回页面、链接或底层错误。 */
export type EgoAuthorizationStatus = (typeof statuses)[number]

function validAuthorization(value: string): boolean {
  try {
    const url = new URL(value)
    const keys = [...url.searchParams.keys()]
    return (
      value.startsWith("https://pigclaude.com/authorize/") &&
      url.origin === "https://pigclaude.com" &&
      !url.username &&
      !url.password &&
      !url.hash &&
      /^\/authorize\/[A-Za-z0-9_-]+\/approve$/.test(url.pathname) &&
      keys.every((key) => ["client_id", "purpose", "state", "mode"].includes(key)) &&
      new Set(keys).size === keys.length &&
      Boolean(url.searchParams.get("state")) &&
      (!url.searchParams.has("mode") ||
        ["login", "register", "authorize"].includes(url.searchParams.get("mode")!)) &&
      (!url.searchParams.has("client_id") ||
        url.searchParams.get("client_id") === "pigclaude-desktop") &&
      (!url.searchParams.has("purpose") || url.searchParams.get("purpose") === "pigclaude-login")
    )
  } catch {
    return false
  }
}

// 固定脚本不含输入；浏览器快照只留在子进程内存，不打印自动操作回执。
const script =
  `const validAuthorization = ${validAuthorization.toString()};\n` +
  String.raw`
let status = "unavailable";
try {
  const task = await taskSpace(18);
  if (task.ownership !== "agent") throw new Error("unavailable");
  const page = task.page("p1");
  if (input.operation === "open") await page.goto(input.url);
  const currentUrl = await page.url();
  const current = new URL(currentUrl);
  if (current.origin !== "https://pigclaude.com") throw new Error("unavailable");
  const snapshot = await page.snapshot();
  if (/登录|Sign in/.test(snapshot) && !snapshot.includes("确认授权")) status = "login-required";
  else if (/验证您是真人|Verify you are human|Checking your browser/.test(snapshot)) status = "human-required";
  else if (validAuthorization(currentUrl) && snapshot.includes("确认授权")) {
    status = "ready-for-approval";
    if (input.operation === "approve") {
      if (input.replace) await page.click('loc=role:checkbox[name="我确认替换现有设备"]');
      await page.click('loc=role:button[name="确认授权"]');
      await page.waitForSelector('text="设备已授权"', { timeout: 15000 });
      const href = await page.evaluate(() => {
        const links = [...document.querySelectorAll("a")].filter(a => a.textContent.trim() === "返回桌面客户端");
        return links.length === 1 ? links[0].href : null;
      });
      const callback = new URL(href);
      const keys = [...callback.searchParams.keys()];
      if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1" || !callback.port || callback.username || callback.password || callback.hash || callback.pathname !== "/oauth/callback" || keys.length !== 3 || new Set(keys).size !== 3 || !keys.every(key => ["flow_id", "code", "state"].includes(key)) || !callback.searchParams.get("code") || callback.searchParams.get("flow_id") !== current.pathname.split("/")[2] || callback.searchParams.get("state") !== current.searchParams.get("state")) throw new Error("unavailable");
      await page.click('loc=role:link[name="返回桌面客户端"]');
      await page.waitForSelector('text="授权完成"', { timeout: 15000 });
      const final = new URL(await page.url());
      if (final.origin !== callback.origin || final.pathname !== "/oauth/callback") throw new Error("unavailable");
      status = "authorized";
    }
  }
} catch { status = "unavailable"; }
console.log("PIGCLAUDE_EGO_RESULT=" + JSON.stringify({status}));
`

// 全模块只持有一个子进程；没有 close 收据时跨所有 bridge 阻止再次委托。
let activeOwner: { child: ChildProcessWithoutNullStreams } | undefined
const updateNotice =
  "[ego-browser:notice] Ego Lite update is available (current 0.5.1.13). Finish the current browser task, then ask the user before running `ego-browser upgrade`; re-read the ego-browser Skill afterward."

function protocolLines(output: string): string[] {
  return output.split(/\r?\n/).filter((line) => line.trim() !== "" && line !== updateNotice)
}

/** 构造可用假 child 验证的委托；默认必须先验证真实生产门禁。 */
export function createEgoAuthorizationBridge(
  options: {
    launch?: typeof spawn
    gate?: () => void
    environment?: NodeJS.ProcessEnv
    timeoutMs?: number
    cleanupWaitMs?: number
  } = {},
) {
  const run = async (
    input: { operation: "open"; url: string } | { operation: "approve"; replace: boolean },
  ): Promise<EgoAuthorizationStatus> => {
    try {
      ;(options.gate ?? requireProductionDesktopGate)()
      if (activeOwner) return "cleanup-unconfirmed"
      if (input.operation === "open" && !validAuthorization(input.url)) throw new Error()
      const env: Record<string, string> = {}
      const source = options.environment ?? process.env
      for (const key of [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "TMPDIR",
        "LANG",
        "LC_ALL",
        "LC_CTYPE",
        "__CF_USER_TEXT_ENCODING",
      ]) {
        if (source[key] !== undefined) env[key] = source[key]
      }
      return await new Promise<EgoAuthorizationStatus>((resolve, reject) => {
        const child = (options.launch ?? spawn)("ego-browser", ["nodejs"], {
          env,
          shell: false,
          stdio: "pipe",
        })
        const owner = { child }
        activeOwner = owner
        let stdout = ""
        let stderr = ""
        let size = 0
        let failed = false
        let closed = false
        let settled = false
        let exitTimer: ReturnType<typeof setTimeout> | undefined
        const fail = () => {
          if (failed || closed) return
          failed = true
          clearTimeout(timer)
          exitTimer = setTimeout(
            () => {
              if (!closed && !settled) {
                settled = true
                resolve("cleanup-unconfirmed")
              }
            },
            Math.max(1, Math.min(options.cleanupWaitMs ?? 5000, 5000)),
          )
          try {
            child.kill("SIGKILL")
          } catch {
            /* 继续持有 owner，不能把 kill 异常当作退出。 */
          }
        }
        const timer = setTimeout(fail, Math.max(1, Math.min(options.timeoutMs ?? 60_000, 60_000)))
        child.on("error", fail)
        child.stdin.on("error", fail)
        child.stdout.on("data", (chunk: Buffer) => {
          if (closed || settled) return
          size += chunk.length
          if (size > 65536) fail()
          else stdout += chunk.toString("utf8")
        })
        child.stderr.on("data", (chunk: Buffer) => {
          if (closed || settled) return
          size += chunk.length
          if (size > 65536) fail()
          else stderr += chunk.toString("utf8")
        })
        child.on("close", (code) => {
          if (closed) return
          closed = true
          clearTimeout(timer)
          clearTimeout(exitTimer)
          if (activeOwner === owner) activeOwner = undefined
          if (settled) return
          settled = true
          try {
            if (failed || code !== 0) throw new Error()
            const markers = [...protocolLines(stdout), ...protocolLines(stderr)]
            if (markers.length !== 1 || !markers[0]!.startsWith("PIGCLAUDE_EGO_RESULT="))
              throw new Error()
            const result: unknown = JSON.parse(markers[0]!.slice("PIGCLAUDE_EGO_RESULT=".length))
            if (!result || typeof result !== "object" || Object.keys(result).join() !== "status")
              throw new Error()
            const status = (result as { status: unknown }).status
            if (
              status === "cleanup-unconfirmed" ||
              !statuses.includes(status as EgoAuthorizationStatus)
            )
              throw new Error()
            resolve(status as EgoAuthorizationStatus)
          } catch {
            reject(new Error("Ego授权委托失败"))
          }
        })
        try {
          child.stdin.end(`const input = ${JSON.stringify(input)};\n${script}`)
        } catch {
          fail()
        }
      })
    } catch {
      throw new Error("Ego授权委托失败")
    }
  }
  return {
    open: (url: string) => run({ operation: "open", url }),
    approve: ({ replace }: { replace: boolean }) => run({ operation: "approve", replace }),
  }
}

/** 将已在内存中的生产授权 URL 导航到既有空间18/p1。 */
export function openEgoAuthorization(url: string): Promise<EgoAuthorizationStatus> {
  return createEgoAuthorizationBridge().open(url)
}

/** 在已有正常授权页确认授权，并经核实的 loopback 链接返回桌面。 */
export function approveEgoAuthorization(input: {
  replace: boolean
}): Promise<EgoAuthorizationStatus> {
  return createEgoAuthorizationBridge().approve(input)
}
