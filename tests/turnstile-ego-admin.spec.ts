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
  const evaluate = async (fn: typeof adminPage, argument: AdminCommand): Promise<AdminFacts> =>
    runInNewContext(`(${fn.toString()})(argument)`, {
      argument,
      window,
      location: { origin: "https://admin.pigclaude.com" },
      AbortSignal,
      fetch: async (path: string, init: RequestInit = {}) => {
        calls.push({ path, init })
        const body = JSON.parse(String(init.body ?? "{}")) as Record<string, unknown>
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
    expect(JSON.stringify(init.headers)).not.toMatch(/Origin|Cookie|Authorization/)
    expect(String(init.body)).not.toContain("secretKey")
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
  const home = proofFixture()
  const { installProof } = await import("./turnstile-ego-controller")
  await installProof(home, { case: "hostname", nonce })
  home.callbacks[0]("local-home-admin-action")
  const result = await runHostname(home, admin, nonce, nonce)
  expect(result.statuses).toEqual([400])
  expect(result.activeRevision).toBe("3")
  expect(result.requestedHostname).toBe("pigclaude.com")
  expect(JSON.stringify(result)).not.toMatch(/local-home-admin-action|local-site-key/)
  expect(home.removed).toEqual(["owned-widget-1"])
})
