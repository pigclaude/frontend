// 负责固定生产拒绝场景的短轮次编排，真实 proof 仅经过页面和当前 Node 进程内存。
import { passwordPath, type PasswordInteraction } from "./turnstile-current-interaction"
import { proofPage, type ProofCommand, type ProofReply } from "./turnstile-ego-proof"
import { adminPage, type AdminCommand, type AdminFacts } from "./turnstile-ego-admin"

/** Ego 的最小页面序列化能力；不依赖 Playwright runtime。 */
export interface ProofPagePort {
  /** 执行唯一自包含 proof 入口。 */
  evaluate(fn: typeof proofPage, command: ProofCommand): Promise<ProofReply>
}
/** 传输夹具仍接收固定生产 URL，不能将生产目标改成另一个 URL。 */
export type LoginTransport = (url: string, init: RequestInit) => Promise<Response>
/** 对外事实严格不含 proof、自由文本、SDK 原始错误或响应正文。 */
export type ProofFacts = Omit<ProofReply, "proof">

/** 已正常登录的 Ego admin Page；不读取或传送 Cookie。 */
export interface AdminPagePort {
  /** 仅执行固定的自包含同源管理员操作。 */
  evaluate(fn: typeof adminPage, command: AdminCommand): Promise<AdminFacts>
}

function freshAge(browserAgeMs: number | null, started: number): number {
  const age =
    browserAgeMs === null ? Infinity : Math.ceil(browserAgeMs + performance.now() - started)
  if (!Number.isSafeInteger(age) || age < 0 || age > 240_000)
    throw new Error("proof 新鲜度预算不足；未重新生成 proof")
  return age
}

function adminFacts(value: AdminFacts): AdminFacts {
  const revision = (item: unknown) =>
    typeof item === "string" &&
    /^(0|[1-9][0-9]{0,18})$/.test(item) &&
    BigInt(item) <= 9223372036854775807n
  if (
    Object.keys(value).sort().join(",") !==
      "activeRevision,auditsUnchanged,draftRevision,enabled,hostnames,revision,secretConfigured,stateUnchanged,statuses" ||
    !revision(value.revision) ||
    !revision(value.activeRevision) ||
    !(value.draftRevision === null || revision(value.draftRevision)) ||
    typeof value.enabled !== "boolean" ||
    typeof value.secretConfigured !== "boolean" ||
    typeof value.stateUnchanged !== "boolean" ||
    typeof value.auditsUnchanged !== "boolean" ||
    !Array.isArray(value.hostnames) ||
    !value.hostnames.every((host) =>
      ["pigclaude.com", "www.pigclaude.com", "admin.pigclaude.com"].includes(host),
    ) ||
    !Array.isArray(value.statuses) ||
    !value.statuses.every((status) => [200, 400, 403, 409].includes(status))
  )
    throw new Error("管理员事实无效")
  return { ...value }
}

/** 使用 owner/read-only 当前会话执行固定同源操作，不接受 proof 或任意请求体。 */
export async function runAdmin(
  page: AdminPagePort,
  operation: Exclude<AdminCommand["operation"], "reject-hostname">,
  nonce: string,
) {
  try {
    const result = adminFacts(await page.evaluate(adminPage, { operation, nonce }))
    const expected = {
      summary: "[]",
      "owner-rejections": "[400,409]",
      "prepare-hostname": "[200]",
      "readonly-rejection": "[403]",
    }[operation]
    if (
      JSON.stringify(result.statuses) !== expected ||
      (["owner-rejections", "readonly-rejection"].includes(operation) &&
        (!result.stateUnchanged || !result.auditsUnchanged))
    )
      throw new Error("管理员结果无效")
    return result
  } catch {
    throw new Error("管理员边界场景失败；该项尚未验证")
  }
}

/** home 的实际 admin_login proof 仅在当前 Node 内存中转到真实 admin 同源 activate。 */
export async function runHostname(
  home: ProofPagePort,
  admin: AdminPagePort,
  proofNonce: string,
  adminNonce: string,
) {
  const command = { case: "hostname", nonce: proofNonce } as const
  const started = performance.now()
  const before = await readProofFacts(home, command)
  if (before.status !== "ready") throw new Error("hostname proof 尚未就绪")
  freshAge(before.ageMs, started)
  let proof: string | undefined
  let completed = false
  try {
    const taken = await home.evaluate(proofPage, { ...command, operation: "consume" })
    proof = taken.proof
    delete taken.proof
    const checked = facts(taken, { ...command, operation: "consume" })
    if (checked.status !== "consumed" || typeof proof !== "string" || !proof || proof.length > 2048)
      throw new Error("hostname proof 协议无效")
    const dispatchAgeMs = freshAge(
      Math.max(before.ageMs ?? Infinity, checked.ageMs ?? Infinity),
      started,
    )
    // 绝对 deadline 覆盖 Node→admin RPC 传输；页面内另用单调计时覆盖 GET/audits 等待。
    const proofDeadlineEpochMs = Date.now() + (240_000 - dispatchAgeMs)
    const result = adminFacts(
      await admin.evaluate(adminPage, {
        operation: "reject-hostname",
        nonce: adminNonce,
        proof,
        proofDeadlineEpochMs,
      }),
    )
    if (
      JSON.stringify(result.statuses) !== "[400]" ||
      !result.stateUnchanged ||
      !result.auditsUnchanged
    )
      throw new Error("hostname 结果无效")
    freshAge(Math.max(before.ageMs ?? Infinity, checked.ageMs ?? Infinity), started)
    completed = true
    return {
      ...result,
      action: "admin_login" as const,
      requestedHostname: "pigclaude.com" as const,
      ageMs: checked.ageMs,
      dispatchAgeMs,
    }
  } catch {
    throw new Error("真实 hostname 拒绝失败；该项尚未验证")
  } finally {
    proof = undefined
    if (completed) await disposeProof(home, command)
  }
}

function facts(value: ProofReply, command: ProofCommand): ProofFacts {
  const action = ["wrong-action", "hostname", "admin-login"].includes(command.case)
    ? "admin_login"
    : command.case === "home-register"
      ? "home_register"
      : "home_login"
  const requestedHostname = command.case === "admin-login" ? "admin.pigclaude.com" : "pigclaude.com"
  if (
    Object.keys(value).sort().join(",") !== "action,ageMs,case,requestedHostname,status" ||
    value.case !== command.case ||
    value.action !== action ||
    value.requestedHostname !== requestedHostname ||
    !["pending", "ready", "failed", "consumed", "disposed"].includes(value.status) ||
    !(value.ageMs === null || (Number.isSafeInteger(value.ageMs) && value.ageMs >= 0))
  )
    throw new Error("Ego proof 事实无效")
  return { ...value }
}
/** 安装后立即返回安全状态，由 root handOff 后结束当前 CLI 轮次。 */
export async function installProof(page: ProofPagePort, command: Omit<ProofCommand, "operation">) {
  try {
    const input: ProofCommand = { ...command, operation: "install" }
    return facts(await page.evaluate(proofPage, input), input)
  } catch {
    throw new Error("Ego proof 安装失败；尚未验证")
  }
}
/** 真人交还控制后仅读取年龄与有限状态，不向 Node 传递 proof。 */
export async function readProofFacts(
  page: ProofPagePort,
  command: Omit<ProofCommand, "operation">,
) {
  try {
    const input: ProofCommand = { ...command, operation: "facts" }
    return facts(await page.evaluate(proofPage, input), input)
  } catch {
    throw new Error("Ego proof 状态读取失败；尚未验证")
  }
}
/** 清理准确 nonce 的自有实例；不会重置产品验证码或其它会话。 */
export async function disposeProof(page: ProofPagePort, command: Omit<ProofCommand, "operation">) {
  try {
    const input: ProofCommand = { ...command, operation: "dispose" }
    return facts(await page.evaluate(proofPage, input), input)
  } catch {
    throw new Error("Ego proof 清理失败")
  }
}
/** 消费一次并完成固定 replay/action/expiry HTTP 序列；绝不返回 proof。 */
export async function runNegative(
  page: ProofPagePort,
  command: Omit<ProofCommand, "operation">,
  interaction: PasswordInteraction,
  transport: LoginTransport,
) {
  if (!["replay", "wrong-action", "expiry"].includes(command.case)) throw new Error("拒绝场景无效")
  const path = passwordPath(interaction)
  if (interaction.realm !== "User") throw new Error("拒绝场景需要当前User交互")
  const started = performance.now()
  const before = await readProofFacts(page, command)
  if (
    before.status !== "ready" ||
    before.ageMs === null ||
    (command.case === "expiry" && before.ageMs < 306_000)
  )
    throw new Error("proof 尚未满足提交条件；未消费且未发送请求")
  if (command.case !== "expiry") freshAge(before.ageMs, started)
  let proof: string | undefined
  let requested = false
  try {
    const taken = await page.evaluate(proofPage, { ...command, operation: "consume" })
    proof = taken.proof
    delete taken.proof
    const checked = facts(taken, { ...command, operation: "consume" })
    if (
      checked.status !== "consumed" ||
      typeof proof !== "string" ||
      proof.length === 0 ||
      proof.length > 2048 ||
      (command.case === "expiry" && (checked.ageMs === null || checked.ageMs < 306_000))
    )
      throw new Error("proof 消费协议无效")
    const browserAgeMs = Math.max(before.ageMs ?? Infinity, checked.ageMs ?? Infinity)
    let dispatchAgeMs = checked.ageMs
    const post = async () => {
      if (command.case !== "expiry") dispatchAgeMs = freshAge(browserAgeMs, started)
      requested = true
      const response = await transport(`https://www.pigclaude.com${path}`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", origin: "https://www.pigclaude.com" },
        credentials: "include",
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          realm: interaction.realm,
          csrf: interaction.csrf,
          mode: "login",
          email: "negative@example.test",
          password: "negative-password",
          captchaToken: proof,
        }),
      })
      const result = {
        status: response.status,
        noSetCookie: response.headers.get("set-cookie") === null,
      }
      await response.body?.cancel()
      return result
    }
    const first = await post()
    if (first.status !== (command.case === "replay" ? 401 : 400) || !first.noSetCookie)
      throw new Error("拒绝序列未通过")
    const second = command.case === "replay" ? await post() : undefined
    if (second && (second.status !== 400 || !second.noSetCookie)) throw new Error("重放未拒绝")
    return {
      case: command.case,
      action: before.action,
      requestedHostname: before.requestedHostname,
      ageMs: checked.ageMs,
      dispatchAgeMs,
      firstStatus: first.status,
      firstNoSetCookie: first.noSetCookie,
      ...(second ? { replayStatus: second.status, replayNoSetCookie: second.noSetCookie } : {}),
    }
  } catch {
    throw new Error("真实拒绝场景失败；该项尚未验证")
  } finally {
    proof = undefined
    if (requested) await disposeProof(page, command)
  }
}
