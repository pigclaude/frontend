// 负责canonical OP当前交互绑定的自包含proof内存协议，不读取浏览器持久存储。
import type { PasswordInteraction } from "./turnstile-current-interaction"
/** 页面协议仅接受有限场景及随机 ownership nonce。 */
export interface ProofCommand {
  operation: "install" | "facts" | "consume" | "dispose" | "validate"
  /** 仅validate携带原服务器上下文，用于比对，不进入安全facts返值。 */
  interaction?: PasswordInteraction
  case: "replay" | "wrong-action" | "expiry" | "hostname" | "home-register" | "admin-login"
  nonce: string
}
/** 仅 consume 的内部跨进程结果含 proof；调用者不得打印该结果。 */
export interface ProofReply {
  case: ProofCommand["case"]
  status: "pending" | "ready" | "failed" | "consumed" | "disposed"
  ageMs: number | null
  action: "home_register" | "home_login" | "admin_login"
  requestedHostname: "www.pigclaude.com"
  proof?: string
}
/** 自包含序列化入口；仅 controller 可以使用 consume 分支。 */
export async function proofPage(command: ProofCommand): Promise<ProofReply> {
  type Sdk = {
    render(element: HTMLElement, options: Record<string, unknown>): string | undefined
    remove(id: string): void
  }
  type Owned = {
    nonce: string
    case: ProofCommand["case"]
    status: ProofReply["status"]
    proof: string | null
    created: number | null
    widget?: string
    panel?: HTMLElement
    interaction: PasswordInteraction | null
  }
  const win = window as unknown as {
    turnstile?: Sdk
    __pigclaudeTask7Ego?: Owned
  }
  const fail = (): never => {
    throw new Error("Ego proof 协议拒绝；该项尚未验证")
  }
  const cases = {
    replay: "home_login",
    expiry: "home_login",
    "wrong-action": "admin_login",
    hostname: "admin_login",
    "home-register": "home_register",
    "admin-login": "admin_login",
  } as const
  if (
    !command ||
    Object.keys(command).sort().join(",") !==
      (command.operation === "validate"
        ? "case,interaction,nonce,operation"
        : "case,nonce,operation") ||
    !Object.hasOwn(cases, command.case) ||
    !/^[a-f0-9]{32}$/.test(command.nonce) ||
    !["install", "facts", "consume", "dispose", "validate"].includes(command.operation)
  )
    fail()
  const url = new URL(location.href)
  const id = url.searchParams.get("interactionId")
  const selectedRealm = url.searchParams.get("realm")
  const requestedHostname = "www.pigclaude.com" as const
  if (
    url.origin !== "https://www.pigclaude.com" ||
    !["/identity/login", "/identity/authorize"].includes(url.pathname) ||
    url.username ||
    url.password ||
    url.hash ||
    !id ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(id) ||
    url.searchParams.getAll("interactionId").length !== 1 ||
    url.searchParams.getAll("realm").length !== 1 ||
    !["User", "Admin"].includes(selectedRealm ?? "")
  )
    fail()
  const requiredRealm = ["admin-login", "hostname"].includes(command.case) ? "Admin" : "User"
  const action = cases[command.case]
  const same = (a: PasswordInteraction | null, b: PasswordInteraction | undefined) =>
    !!a &&
    !!b &&
    a.interactionId === b.interactionId &&
    a.realm === b.realm &&
    a.csrf === b.csrf &&
    a.phase === b.phase
  const resolve = async (): Promise<PasswordInteraction> => {
    const response = await fetch(
      `/v1/identity/interactions/${encodeURIComponent(id ?? "")}?realm=${selectedRealm}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    ).catch(fail)
    const body: unknown = await response.json().catch(fail)
    if (response.status !== 200 || !body || typeof body !== "object" || Array.isArray(body))
      return fail()
    const value = body as Record<string, unknown>
    if (
      location.href !== url.href ||
      value.interactionId !== id ||
      value.realm !== selectedRealm ||
      value.realm !== requiredRealm ||
      value.phase !== "login" ||
      typeof value.csrf !== "string" ||
      !value.csrf ||
      (command.case === "home-register" && value.registrationAllowed !== true)
    )
      return fail()
    return {
      interactionId: value.interactionId as string,
      realm: value.realm as "User" | "Admin",
      csrf: value.csrf,
      phase: "login",
    }
  }
  const current = () => {
    const owned = win.__pigclaudeTask7Ego
    if (!owned || owned.nonce !== command.nonce || owned.case !== command.case) return fail()
    return owned
  }
  const facts = (owned: Owned): ProofReply => ({
    case: command.case,
    status: owned.status,
    ageMs:
      owned.created === null ? null : Math.max(0, Math.ceil(performance.now() - owned.created)),
    action,
    requestedHostname,
  })
  if (command.operation !== "install") {
    const owned = current()
    // dispose只核验本机nonce/case所有权，不依赖已过期或不可用的服务器交互。
    if (command.operation !== "dispose") {
      const interaction = await resolve()
      if (current() !== owned || !same(owned.interaction, interaction)) fail()
      if (command.operation === "validate" && !same(owned.interaction, command.interaction)) fail()
      if (["facts", "validate"].includes(command.operation)) return facts(owned)
    }
    if (command.operation === "consume") {
      const age = facts(owned).ageMs
      if (
        owned.status !== "ready" ||
        !owned.proof ||
        age === null ||
        (command.case === "expiry" ? age < 306_000 : age > 240_000)
      )
        fail()
      const proof = owned.proof
      owned.proof = null
      owned.status = "consumed"
      return { ...facts(owned), proof: proof ?? undefined }
    }
    owned.proof = null
    owned.status = "disposed"
    if (owned.widget) win.turnstile?.remove(owned.widget)
    owned.panel?.remove()
    const reply = facts(owned)
    delete win.__pigclaudeTask7Ego
    return reply
  }
  if (win.__pigclaudeTask7Ego) fail()
  // 先保留所有权，避免并行 install 在配置读取期间创建第二个实例。
  const owned: Owned = {
    nonce: command.nonce,
    case: command.case,
    status: "pending",
    proof: null,
    created: null,
    interaction: null,
  }
  win.__pigclaudeTask7Ego = owned
  const isCurrent = () =>
    win.__pigclaudeTask7Ego === owned && owned.status === "pending" && location.href === url.href
  try {
    const interaction = await resolve()
    if (!isCurrent()) fail()
    owned.interaction = interaction
    const prefix = interaction.realm === "Admin" ? "/admin/v1" : "/v1"
    const response = await fetch(`${prefix}/auth/captcha`, {
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    })
    const config: unknown = await response.json()
    if (response.status !== 200 || typeof config !== "object" || config === null) fail()
    const value = config as Record<string, unknown>
    if (
      Object.keys(value).sort().join(",") !== "enabled,mode,provider,siteKey" ||
      value.enabled !== true ||
      value.mode !== "required" ||
      value.provider !== "turnstile" ||
      typeof value.siteKey !== "string" ||
      value.siteKey.length === 0 ||
      /^[123]x0{10,}/.test(value.siteKey)
    )
      fail()
    if (!isCurrent()) fail()
    if (!win.turnstile) {
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script")
        const timer = setTimeout(() => {
          script.remove()
          reject(new Error("SDK未就绪"))
        }, 15_000)
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        script.async = true
        script.onload = () => {
          clearTimeout(timer)
          resolve()
        }
        script.onerror = () => {
          clearTimeout(timer)
          script.remove()
          reject(new Error("SDK未就绪"))
        }
        document.head.append(script)
      })
    }
    const sdk = win.turnstile
    if (
      !isCurrent() ||
      !sdk ||
      typeof sdk.render !== "function" ||
      typeof sdk.remove !== "function"
    )
      return fail()
    const dark = document.documentElement.classList.contains("dark")
    const panel = document.createElement("section")
    panel.style.cssText = `padding:24px;margin:16px;border:2px solid #888;position:relative;${dark ? "background:#111;color:#fff" : "background:#fff;color:#111"}`
    const label = document.createElement("p")
    label.textContent = `Task7 真人验证码验收：${command.case}（${action}）`
    const widget = document.createElement("div")
    panel.append(label, widget)
    owned.panel = panel
    document.body.prepend(panel)
    const failed = () => {
      if (isCurrent()) owned.status = "failed"
    }
    owned.widget = sdk.render(widget, {
      sitekey: value.siteKey,
      action,
      theme: dark ? "dark" : "light",
      language: "zh-cn",
      size: "normal",
      "response-field": false,
      retry: "never",
      "refresh-expired": "never",
      "refresh-timeout": "never",
      callback: (proof: unknown) => {
        if (isCurrent() && typeof proof === "string" && proof.length > 0 && proof.length <= 2048) {
          owned.proof = proof
          owned.created = performance.now()
          owned.status = "ready"
        }
      },
      // 过期后仍保留原始 proof，专供首次延迟提交；绝不刷新或接纳替换回调。
      "expired-callback": failed,
      "error-callback": failed,
      "timeout-callback": failed,
      "unsupported-callback": failed,
    })
    if (!owned.widget) fail()
    return facts(owned)
  } catch {
    if (win.__pigclaudeTask7Ego === owned) {
      owned.proof = null
      owned.status = "failed"
      if (owned.widget) win.turnstile?.remove(owned.widget)
      owned.panel?.remove()
    }
    return fail()
  }
}
