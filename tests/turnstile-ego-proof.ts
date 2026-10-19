// 负责 Ego 真人 proof 的自包含页面内存协议，不读取浏览器持久存储。
/** 页面协议仅接受有限场景及随机 ownership nonce。 */
export interface ProofCommand {
  operation: "install" | "facts" | "consume" | "dispose"
  case: "replay" | "wrong-action" | "expiry" | "hostname" | "home-register" | "admin-login"
  nonce: string
}
/** 仅 consume 的内部跨进程结果含 proof；调用者不得打印该结果。 */
export interface ProofReply {
  case: ProofCommand["case"]
  status: "pending" | "ready" | "failed" | "consumed" | "disposed"
  ageMs: number | null
  action: "home_register" | "home_login" | "admin_login"
  requestedHostname: "pigclaude.com" | "admin.pigclaude.com"
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
    Object.keys(command).sort().join(",") !== "case,nonce,operation" ||
    !Object.hasOwn(cases, command.case) ||
    !/^[a-f0-9]{32}$/.test(command.nonce) ||
    !["install", "facts", "consume", "dispose"].includes(command.operation)
  )
    fail()
  const admin = command.case === "admin-login"
  const requestedHostname = admin ? "admin.pigclaude.com" : "pigclaude.com"
  if (location.origin !== `https://${requestedHostname}` || location.pathname !== "/login") fail()
  const action = cases[command.case]
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
    if (command.operation === "facts") return facts(owned)
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
  }
  win.__pigclaudeTask7Ego = owned
  const isCurrent = () => win.__pigclaudeTask7Ego === owned && owned.status === "pending"
  try {
    const prefix = admin ? "/admin/v1" : "/v1"
    const response = await fetch(`${prefix}/auth/captcha`, {
      credentials: "same-origin",
      cache: "no-store",
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
