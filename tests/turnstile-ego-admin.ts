// 负责现有管理员会话的同源设置边界；不导出 Cookie、Site Key、Secret 或审计正文。
/** 固定管理员操作；proof 只允许 hostname 拒绝场景在内存中传入。 */
export interface AdminCommand {
  operation:
    "summary" | "owner-rejections" | "prepare-hostname" | "reject-hostname" | "readonly-rejection"
  nonce: string
  proof?: string
  proofDeadlineEpochMs?: number
}
/** 允许 root 保存的有限管理员事实。 */
export interface AdminFacts {
  revision: string
  activeRevision: string
  enabled: boolean
  hostnames: ("pigclaude.com" | "www.pigclaude.com" | "admin.pigclaude.com")[]
  secretConfigured: boolean
  draftRevision: string | null
  statuses: number[]
  stateUnchanged: boolean
  auditsUnchanged: boolean
}
/** 自包含页面入口；所有 fetch 使用当前真实后台 session 和浏览器自然 Origin。 */
export async function adminPage(command: AdminCommand): Promise<AdminFacts> {
  const enteredAt = performance.now()
  type Summary = {
    revision: string
    enabled: boolean
    mode: string
    siteKey: string
    hostnames: AdminFacts["hostnames"]
    secretConfigured: boolean
    updatedAt: string
    updatedBy: string
  }
  type View = { revision: string; active: Summary; draft: Summary | null }
  type Owned = { nonce: string; revision: string; active: string }
  const win = window as unknown as { __pigclaudeTask7Admin?: Owned }
  const fail = (): never => {
    throw new Error("Ego 管理员协议拒绝；该项尚未验证")
  }
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)
  const keys = (value: object, expected: string) => Object.keys(value).sort().join(",") === expected
  const revision = (value: unknown): value is string =>
    typeof value === "string" &&
    /^(0|[1-9][0-9]{0,18})$/.test(value) &&
    BigInt(value) <= 9223372036854775807n
  const summary = (value: unknown): value is Summary =>
    record(value) &&
    keys(value, "enabled,hostnames,mode,revision,secretConfigured,siteKey,updatedAt,updatedBy") &&
    revision(value.revision) &&
    value.enabled === true &&
    value.mode === "required" &&
    typeof value.siteKey === "string" &&
    value.siteKey.length > 0 &&
    !/^[123]x0{10,}/.test(value.siteKey) &&
    value.secretConfigured === true &&
    typeof value.updatedAt === "string" &&
    typeof value.updatedBy === "string" &&
    Array.isArray(value.hostnames) &&
    value.hostnames.length > 0 &&
    new Set(value.hostnames).size === value.hostnames.length &&
    value.hostnames.every((host: unknown) =>
      ["pigclaude.com", "www.pigclaude.com", "admin.pigclaude.com"].includes(String(host)),
    )
  if (
    location.origin !== "https://admin.pigclaude.com" ||
    location.pathname !== "/settings" ||
    !command ||
    !/^[a-f0-9]{32}$/.test(command.nonce) ||
    ![
      "summary",
      "owner-rejections",
      "prepare-hostname",
      "reject-hostname",
      "readonly-rejection",
    ].includes(command.operation) ||
    !keys(
      command,
      command.operation === "reject-hostname"
        ? "nonce,operation,proof,proofDeadlineEpochMs"
        : "nonce,operation",
    )
  )
    return fail()
  if (
    command.operation === "reject-hostname" &&
    (typeof command.proof !== "string" ||
      command.proof.length === 0 ||
      command.proof.length > 2048 ||
      !Number.isSafeInteger(command.proofDeadlineEpochMs) ||
      win.__pigclaudeTask7Admin?.nonce !== command.nonce)
  )
    return fail()
  const budget =
    command.operation === "reject-hostname" ? (command.proofDeadlineEpochMs ?? 0) - Date.now() : 0
  const fresh = () => {
    if (
      budget <= 0 ||
      budget > 240_000 ||
      performance.now() - enteredAt > budget ||
      Date.now() > (command.proofDeadlineEpochMs ?? 0)
    )
      return fail()
  }
  if (command.operation === "reject-hostname") fresh()
  if (command.operation === "prepare-hostname" && win.__pigclaudeTask7Admin) return fail()
  // 当前Admin RP bootstrap是设置写入CSRF的唯一来源，不借用OP交互或查询参数。
  const sessionResponse = await fetch("/admin/v1/session", {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  }).catch(fail)
  const session: unknown = await sessionResponse.json().catch(fail)
  if (
    sessionResponse.status !== 200 ||
    !record(session) ||
    session.principalType !== "Admin" ||
    typeof session.principalId !== "string" ||
    !session.principalId ||
    typeof session.csrf !== "string" ||
    !session.csrf
  )
    return fail()
  const csrf = session.csrf
  const path = "/admin/v1/settings/turnstile"
  const request = async (suffix = "", method = "GET", body?: object) => {
    try {
      return await fetch(`${path}${suffix}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          "content-type": "application/json",
          ...(method === "GET" ? {} : { "x-csrf-token": csrf }),
        },
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
    } catch {
      return fail()
    }
  }
  const read = async (): Promise<View> => {
    const response = await request()
    const value: unknown = await response.json().catch(fail)
    if (
      response.status !== 200 ||
      !record(value) ||
      !keys(value, "active,draft,revision") ||
      !revision(value.revision) ||
      !summary(value.active) ||
      !(value.draft === null || summary(value.draft))
    )
      return fail()
    return value as View
  }
  const audits = async () => {
    const response = await request("/audits")
    const value: unknown = await response.json().catch(fail)
    if (
      response.status !== 200 ||
      !record(value) ||
      !keys(value, "items,nextCursor") ||
      !(value.nextCursor === null || revision(value.nextCursor)) ||
      !Array.isArray(value.items) ||
      !value.items.every(
        (item: unknown) =>
          record(item) &&
          keys(item, "actor,changedFields,revision,time,type") &&
          revision(item.revision) &&
          typeof item.actor === "string" &&
          typeof item.time === "string" &&
          typeof item.type === "string" &&
          Array.isArray(item.changedFields) &&
          item.changedFields.every((field: unknown) => typeof field === "string"),
      )
    )
      return fail()
    return JSON.stringify(value)
  }
  const result = (
    view: View,
    statuses: number[],
    stateUnchanged: boolean,
    auditsUnchanged: boolean,
  ): AdminFacts => ({
    revision: view.revision,
    activeRevision: view.active.revision,
    enabled: view.active.enabled,
    hostnames: view.active.hostnames,
    secretConfigured: view.active.secretConfigured,
    draftRevision: view.draft?.revision ?? null,
    statuses,
    stateUnchanged,
    auditsUnchanged,
  })
  const before = await read()
  if (command.operation === "summary") return result(before, [], true, true)
  const priorAudits = await audits()
  const draft = {
    expectedRevision: before.revision,
    enabled: true,
    siteKey: before.active.siteKey,
    hostnames: ["admin.pigclaude.com"],
  }
  const statuses: number[] = []
  if (command.operation === "owner-rejections") {
    if (before.revision === "0") return fail()
    for (const [body, expected] of [
      [{ ...draft, hostnames: ["invalid/path"] }, 400],
      [{ ...draft, expectedRevision: "0" }, 409],
    ] as const) {
      const response = await request("/draft", "PUT", body)
      statuses.push(response.status)
      if (
        response.status !== expected ||
        JSON.stringify(await read()) !== JSON.stringify(before) ||
        (await audits()) !== priorAudits
      )
        return fail()
    }
    return result(before, statuses, true, true)
  }
  if (command.operation === "prepare-hostname") {
    const response = await request("/draft", "PUT", draft)
    const after = await read()
    if (
      response.status !== 200 ||
      after.revision === before.revision ||
      JSON.stringify(after.active) !== JSON.stringify(before.active) ||
      after.draft?.hostnames.join(",") !== "admin.pigclaude.com" ||
      after.draft.siteKey !== before.active.siteKey ||
      after.draft.revision !== after.revision
    )
      return fail()
    win.__pigclaudeTask7Admin = {
      nonce: command.nonce,
      revision: after.revision,
      active: JSON.stringify(before.active),
    }
    return result(after, [200], false, (await audits()) === priorAudits)
  }
  if (command.operation === "reject-hostname") {
    const owned = win.__pigclaudeTask7Admin
    if (
      !owned ||
      before.revision !== owned.revision ||
      JSON.stringify(before.active) !== owned.active ||
      before.draft?.hostnames.join(",") !== "admin.pigclaude.com"
    )
      return fail()
    fresh()
    const response = await request("/activate", "POST", {
      expectedRevision: before.revision,
      captchaToken: command.proof,
    })
    statuses.push(response.status)
    if (response.status !== 400) return fail()
  } else {
    const response = await request("/draft", "PUT", draft)
    statuses.push(response.status)
    if (response.status !== 403) return fail()
  }
  const after = await read()
  if (JSON.stringify(after) !== JSON.stringify(before) || (await audits()) !== priorAudits)
    return fail()
  if (command.operation === "reject-hostname") delete win.__pigclaudeTask7Admin
  return result(after, statuses, true, true)
}
