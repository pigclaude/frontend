// 负责把内存授权 URL 经 stdin 委托给已有 Ego 空间；只返回有限安全状态。
import { spawn } from "node:child_process"
import { requireProductionDesktopGate } from "./phase1-production-desktop-support"

const statuses = [
  "ready-for-approval",
  "login-required",
  "human-required",
  "unavailable",
  "authorized",
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
      keys.every((key) => ["client_id", "purpose", "state"].includes(key)) &&
      new Set(keys).size === keys.length &&
      Boolean(url.searchParams.get("state")) &&
      (!url.searchParams.has("client_id") ||
        url.searchParams.get("client_id") === "pigclaude-desktop") &&
      (!url.searchParams.has("purpose") || url.searchParams.get("purpose") === "pigclaude-login")
    )
  } catch {
    return false
  }
}

// 固定脚本不含输入；浏览器快照只留在子进程内存，不打印自动操作回执。
const script = String.raw`
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
let status = "unavailable";
try {
  const task = await taskSpace(18);
  if (task.ownership !== "agent") throw new Error("unavailable");
  const page = task.page("p1");
  if (input.operation === "open") await page.goto(input.url);
  const current = new URL(await page.url());
  if (current.origin !== "https://pigclaude.com") throw new Error("unavailable");
  const snapshot = await page.snapshot();
  if (/登录|Sign in/.test(snapshot) && !snapshot.includes("确认授权")) status = "login-required";
  else if (/验证您是真人|Verify you are human|Checking your browser/.test(snapshot)) status = "human-required";
  else if (/^\/authorize\/[A-Za-z0-9_-]+\/approve$/.test(current.pathname) && snapshot.includes("确认授权")) {
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
      if (callback.protocol !== "http:" || callback.hostname !== "127.0.0.1" || !callback.port || callback.username || callback.password || callback.hash || callback.pathname !== "/oauth/callback" || keys.length !== 2 || !keys.includes("code") || !keys.includes("state") || !callback.searchParams.get("code") || !callback.searchParams.get("state")) throw new Error("unavailable");
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

/** 构造可用假 child 验证的委托；默认必须先验证真实生产门禁。 */
export function createEgoAuthorizationBridge(
  options: {
    launch?: typeof spawn
    gate?: () => void
    environment?: NodeJS.ProcessEnv
  } = {},
) {
  const run = async (
    input: { operation: "open"; url: string } | { operation: "approve"; replace: boolean },
  ): Promise<EgoAuthorizationStatus> => {
    try {
      ;(options.gate ?? requireProductionDesktopGate)()
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
        const child = (options.launch ?? spawn)("ego-browser", ["nodejs", "-e", script], {
          env,
          shell: false,
          stdio: "pipe",
        })
        let stdout = ""
        let size = 0
        let failed = false
        const fail = () => {
          failed = true
          child.kill("SIGKILL")
        }
        const timer = setTimeout(fail, 60_000)
        const exitTimer = setTimeout(() => {
          fail()
          reject(new Error("Ego授权委托失败"))
        }, 65_000)
        child.on("error", () => {
          failed = true
        })
        child.stdin.on("error", fail)
        child.stdout.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > 65536) fail()
          else stdout += chunk.toString("utf8")
        })
        child.stderr.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > 65536) fail()
        })
        child.on("close", (code) => {
          clearTimeout(timer)
          clearTimeout(exitTimer)
          try {
            if (failed || code !== 0) throw new Error()
            const markers = stdout
              .split(/\r?\n/)
              .filter((line) => line.startsWith("PIGCLAUDE_EGO_RESULT="))
            if (markers.length !== 1) throw new Error()
            const result: unknown = JSON.parse(markers[0]!.slice("PIGCLAUDE_EGO_RESULT=".length))
            if (!result || typeof result !== "object" || Object.keys(result).join() !== "status")
              throw new Error()
            const status = (result as { status: unknown }).status
            if (!statuses.includes(status as EgoAuthorizationStatus)) throw new Error()
            resolve(status as EgoAuthorizationStatus)
          } catch {
            reject(new Error("Ego授权委托失败"))
          }
        })
        child.stdin.end(JSON.stringify(input))
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
