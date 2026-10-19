// 负责同源管理员边界的本地协议验证；夹具数据不代表生产验收结果。
import { runInNewContext } from "node:vm"
import { test, expect } from "@playwright/test"
import { adminPage, type AdminCommand, type AdminFacts } from "./turnstile-ego-admin"
import { runAdmin, runHostname } from "./turnstile-ego-controller"
import { proofFixture } from "./turnstile-ego-fixture"

const nonce = "0123456789abcdef0123456789abcdef"
function fixture(readonly = false) {
  const summary = {
    revision: "3",
    enabled: true,
    mode: "required",
    siteKey: "local-site-key",
    hostnames: ["pigclaude.com", "www.pigclaude.com", "admin.pigclaude.com"],
    secretConfigured: true,
    updatedAt: "2026-10-19T00:00:00Z",
    updatedBy: "local-owner",
  }
  const state = { revision: "3", active: summary, draft: null as typeof summary | null }
  const window = {}
  let mutateRejected = false
  const calls: { path: string; init: RequestInit }[] = []
  let readDelayMs = 0
  let session: unknown = {
    principalType: "Admin",
    principalId: "local-admin",
    csrf: "local-admin-session-csrf",
  }
  const evaluate = async (fn: typeof adminPage, argument: AdminCommand): Promise<AdminFacts> =>
    runInNewContext(`(${fn.toString()})(argument)`, {
      argument,
      window,
      location: { origin: "https://admin.pigclaude.com", pathname: "/settings" },
      AbortSignal,
      Headers,
      performance,
      fetch: async (path: string, init: RequestInit = {}) => {
        if (init.method === "GET" && readDelayMs)
          await new Promise((resolve) => setTimeout(resolve, readDelayMs))
        calls.push({ path, init })
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>
        if (path === "/admin/v1/session")
          return {
            status: 200,
            json: async () => session,
          }
        if (
          init.method !== "GET" &&
          new Headers(init.headers).get("x-csrf-token") !== "local-admin-session-csrf"
        )
          return { status: 403, json: async () => ({ error: "access_denied" }) }
        let status = 200
        if (path.endsWith("/draft")) {
          if (readonly) status = 403
          else if (JSON.stringify(body.hostnames).includes("invalid/path")) status = 400
          else if (body.expectedRevision === "0") status = 409
          else {
            state.revision = "4"
            state.draft = { ...summary, revision: "4", hostnames: ["admin.pigclaude.com"] }
          }
        } else if (path.endsWith("/activate")) {
          status = 400
          if (mutateRejected) state.revision = "5"
        }
        const result = path.endsWith("/audits") ? { items: [], nextCursor: null } : state
        return { status, json: async () => JSON.parse(JSON.stringify(result)) }
      },
    })
  return {
    evaluate,
    calls,
    state,
    bootstrap: (value: unknown) => {
      session = value
    },
    delayReads: (milliseconds: number) => {
      readDelayMs = milliseconds
    },
    mutate: () => {
      mutateRejected = true
    },
  }
}

test("owner格式400/CAS409均保留完整状态审计，写入不伪造Origin且不含Secret", async () => {
  const page = fixture()
  const result = await page.evaluate(adminPage, { operation: "owner-rejections", nonce })
  expect(result.statuses).toEqual([400, 409])
  expect(result.stateUnchanged && result.auditsUnchanged).toBe(true)
  for (const { init } of page.calls) {
    expect(init.credentials).toBe("same-origin")
    expect(JSON.stringify(init.headers ?? {})).not.toMatch(/Origin|Cookie|Authorization/)
    expect(String(init.body)).not.toContain("secretKey")
    if (init.method !== "GET" && init.method !== undefined)
      expect(new Headers(init.headers).get("x-csrf-token")).toBe("local-admin-session-csrf")
  }
  expect(JSON.stringify(result)).not.toMatch(/local-site-key|local-owner/)
})

test("admin-only草稿保留旧active，错误hostname的400必须不改变版本/审计", async () => {
  const page = fixture()
  const prepared = await page.evaluate(adminPage, { operation: "prepare-hostname", nonce })
  expect(prepared.revision).toBe("4")
  expect(prepared.activeRevision).toBe("3")
  const result = await page.evaluate(adminPage, {
    operation: "reject-hostname",
    nonce,
    proof: "local-home-admin-action",
    proofDeadlineEpochMs: Date.now() + 240_000,
  })
  expect(result.statuses).toEqual([400])
  expect(result.revision).toBe("4")
  expect(result.stateUnchanged && result.auditsUnchanged).toBe(true)
  const mutation = fixture()
  await mutation.evaluate(adminPage, { operation: "prepare-hostname", nonce })
  mutation.mutate()
  await expect(
    mutation.evaluate(adminPage, {
      operation: "reject-hostname",
      nonce,
      proof: "local-home-admin-action",
      proofDeadlineEpochMs: Date.now() + 240_000,
    }),
  ).rejects.toThrow()
})

test("错误nonce/操作/proof在请求前拒绝，未prepare不执行activate", async () => {
  const page = fixture()
  for (const argument of [
    { operation: "summary", nonce: "local-secret" },
    { operation: "secret", nonce },
    { operation: "summary", nonce, proof: "local-secret" },
    { operation: "reject-hostname", nonce, proof: "local-proof" },
  ])
    await expect(page.evaluate(adminPage, argument as AdminCommand)).rejects.toThrow()
  expect(page.calls.length).toBe(0)
})

test("只读会话403保留状态审计，controller不接受安全字段夹带任意秘密", async () => {
  const page = fixture(true)
  const result = await runAdmin(page, "readonly-rejection", nonce)
  expect(result.statuses).toEqual([403])
  expect(result.stateUnchanged && result.auditsUnchanged).toBe(true)
  const invalid = { evaluate: async () => ({ ...result, revision: "local-secret" }) }
  await expect(runAdmin(invalid, "summary", nonce)).rejects.toThrow("管理员边界场景失败")
})

test("hostname controller只在内存转交proof，拒绝后清理owned widget且不回proof", async () => {
  const admin = fixture()
  await runAdmin(admin, "prepare-hostname", nonce)
  const home = proofFixture(
    "https://www.pigclaude.com/identity/login?interactionId=local-interaction&realm=Admin",
  )
  const { installProof } = await import("./turnstile-ego-controller")
  await installProof(home, { case: "hostname", nonce })
  home.callbacks[0]("local-home-admin-action")
  const result = await runHostname(home, admin, nonce, nonce)
  expect(result.statuses).toEqual([400])
  expect(result.activeRevision).toBe("3")
  expect(result.requestedHostname).toBe("www.pigclaude.com")
  expect(JSON.stringify(result)).not.toMatch(/local-home-admin-action|local-site-key/)
  expect(home.removed).toEqual(["owned-widget-1"])
  expect(result.ageMs).toBe(0)
  expect(result.dispatchAgeMs).toBeLessThanOrEqual(240_000)
})

test("hostname超过240000ms含306000ms旧proof不消费且没有admin调用", async () => {
  for (const ageMs of [240_001, 306_000]) {
    const admin = fixture()
    await runAdmin(admin, "prepare-hostname", nonce)
    const home = proofFixture(
      "https://www.pigclaude.com/identity/login?interactionId=local-interaction&realm=Admin",
    )
    const { installProof, readProofFacts } = await import("./turnstile-ego-controller")
    await installProof(home, { case: "hostname", nonce })
    home.callbacks[0]("local-stale-hostname-proof")
    home.advance(ageMs)
    const calls = admin.calls.length
    await expect(runHostname(home, admin, nonce, nonce)).rejects.toThrow()
    expect(admin.calls.length).toBe(calls)
    expect((await readProofFacts(home, { case: "hostname", nonce })).status).toBe("ready")
    expect(home.removed).toEqual([])
  }
})

test("hostname的consume回包/跨页RPC/页面GET/回程延迟均不能形成新鲜400证据", async () => {
  for (const stage of ["consume", "outbound", "reads", "return"] as const) {
    const admin = fixture()
    await runAdmin(admin, "prepare-hostname", nonce)
    const home = proofFixture(
      "https://www.pigclaude.com/identity/login?interactionId=local-interaction&realm=Admin",
    )
    const { installProof, readProofFacts } = await import("./turnstile-ego-controller")
    await installProof(home, { case: "hostname", nonce })
    home.callbacks[0]("local-fixed-age-hostname-proof")
    home.advance(239_900)
    if (stage === "reads") admin.delayReads(150)
    const homePort = {
      evaluate: async (
        fn: Parameters<typeof home.evaluate>[0],
        command: Parameters<typeof home.evaluate>[1],
      ) => {
        const result = await home.evaluate(fn, command)
        if (stage === "consume" && command.operation === "consume")
          await new Promise((resolve) => setTimeout(resolve, 150))
        return result
      },
    }
    const adminPort = {
      evaluate: async (fn: typeof adminPage, command: AdminCommand) => {
        if (stage === "outbound") await new Promise((resolve) => setTimeout(resolve, 150))
        const result = await admin.evaluate(fn, command)
        if (stage === "return") await new Promise((resolve) => setTimeout(resolve, 150))
        return result
      },
    }
    const beforeCalls = admin.calls.length
    await expect(runHostname(homePort, adminPort, nonce, nonce)).rejects.toThrow()
    const posts = admin.calls.slice(beforeCalls).filter((call) => call.path.endsWith("/activate"))
    expect(posts.length).toBe(stage === "return" ? 1 : 0)
    if (stage === "consume" || stage === "outbound") expect(admin.calls.length).toBe(beforeCalls)
    expect((await readProofFacts(home, { case: "hostname", nonce })).status).toBe("consumed")
    expect(home.removed).toEqual([])
  }
})

test("设置链只接受真实Admin bootstrap的非空CSRF，拒绝User或缺失上下文", async () => {
  for (const session of [
    { principalType: "User", principalId: "local-user", csrf: "local-admin-session-csrf" },
    { principalType: "Admin", principalId: "local-admin", csrf: "" },
  ]) {
    const page = fixture()
    page.bootstrap(session)
    await expect(runAdmin(page, "owner-rejections", nonce)).rejects.toThrow("管理员边界场景失败")
    expect(page.calls.map((call) => call.path)).toEqual(["/admin/v1/session"])
  }
})
