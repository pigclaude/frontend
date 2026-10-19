// 负责在同一canonical页面状态贯通真实proof协议、服务器交互读取及negative controller。
import { test, expect, type Page } from "@playwright/test"
import { proofPage } from "./turnstile-ego-proof"
import { proofFixture } from "./turnstile-ego-fixture"
import { installProof, runNegative, readProofFacts, disposeProof } from "./turnstile-ego-controller"
import { readPasswordInteraction } from "./turnstile-current-interaction"
const nonce = "0123456789abcdef0123456789abcdef"
const canonical =
  "https://www.pigclaude.com/identity/login?interactionId=local-interaction&realm=User"
test("同一canonical页面取得服务器CSRF并完成proof单消费及401到400序列", async () => {
  const page = proofFixture(canonical + "&csrf=attacker")
  const interaction = await readPasswordInteraction(page as unknown as Page)
  expect(interaction.csrf).toBe("local-csrf")
  const command = { case: "replay", nonce } as const
  const installed = await installProof(page, command)
  expect(installed.requestedHostname).toBe("www.pigclaude.com")
  expect(page.paths).toContain("/v1/auth/captcha")
  page.callbacks[0]("local-composed-proof")
  const checked = await page.evaluate(proofPage, { ...command, operation: "validate", interaction })
  expect(Object.keys(checked).sort()).toEqual([
    "action",
    "ageMs",
    "case",
    "requestedHostname",
    "status",
  ])
  expect(JSON.stringify(checked)).not.toMatch(/local-csrf|local-composed-proof|local-interaction/)
  const bodies: Record<string, unknown>[] = []
  const result = await runNegative(page, command, interaction, async (url, init) => {
    expect(url).toBe(
      "https://www.pigclaude.com/v1/identity/interactions/local-interaction/password",
    )
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    bodies.push(body)
    expect(body.csrf).toBe(interaction.csrf)
    expect(body.realm).toBe("User")
    return new Response(null, { status: bodies.length === 1 ? 401 : 400 })
  })
  expect(bodies).toHaveLength(2)
  expect(result.requestedHostname).toBe("www.pigclaude.com")
  expect(JSON.stringify(result)).not.toMatch(/local-csrf|local-composed-proof|local-interaction/)
  expect(page.removed).toEqual(["owned-widget-1"])
})
test("Admin OP同样位于www，按实际服务器realm读取Admin公开配置", async () => {
  const page = proofFixture(
    canonical
      .replace("realm=User", "realm=Admin")
      .replace("/identity/login", "/identity/authorize"),
  )
  const view = await readPasswordInteraction(page as unknown as Page)
  expect(view.realm).toBe("Admin")
  const facts = await installProof(page, { case: "admin-login", nonce })
  expect(facts.requestedHostname).toBe("www.pigclaude.com")
  expect(page.options[0].action).toBe("admin_login")
  expect(page.paths).toContain("/admin/v1/auth/captcha")
  expect(page.paths).not.toContain("/v1/auth/captcha")
})
test("旧页面、伪造realm或跨realm case不能渲染proof", async () => {
  for (const url of [
    "https://pigclaude.com/login",
    "https://admin.pigclaude.com/login",
    "https://www.pigclaude.com/login",
    "https://admin.pigclaude.com/settings",
  ]) {
    const page = proofFixture(url)
    await expect(installProof(page, { case: "replay", nonce })).rejects.toThrow()
    expect(page.nodes).toEqual([])
  }
  const mismatch = proofFixture(canonical)
  mismatch.serverInteraction({
    interactionId: "local-interaction",
    realm: "Admin",
    csrf: "server",
    phase: "login",
  })
  await expect(installProof(mismatch, { case: "replay", nonce })).rejects.toThrow()
  expect(mismatch.nodes).toEqual([])
  const admin = proofFixture(canonical.replace("realm=User", "realm=Admin"))
  await expect(installProof(admin, { case: "home-register", nonce })).rejects.toThrow()
  expect(admin.nodes).toEqual([])
})
test("控制器拒绝另一交互的手工context，当前proof保持未消费", async () => {
  const page = proofFixture(canonical)
  const view = await readPasswordInteraction(page as unknown as Page)
  const command = { case: "replay", nonce } as const
  await installProof(page, command)
  page.callbacks[0]("local-owned-proof")
  let requests = 0
  await expect(
    runNegative(page, command, { ...view, interactionId: "other" }, async () => {
      requests++
      return new Response(null, { status: 401 })
    }),
  ).rejects.toThrow()
  expect(requests).toBe(0)
  expect((await readProofFacts(page, command)).status).toBe("ready")
})

test("交互过期或服务器不可用时，消费拒绝但dispose仍按原nonce本机清理", async () => {
  for (const status of [400, 503]) {
    const page = proofFixture(canonical)
    const command = { case: "replay", nonce } as const
    const view = await readPasswordInteraction(page as unknown as Page)
    await installProof(page, command)
    page.callbacks[0]("local-owned-proof")
    page.interactionResponseStatus(status)
    let requests = 0
    await expect(
      runNegative(page, command, view, async () => {
        requests++
        return new Response()
      }),
    ).rejects.toThrow()
    expect(requests).toBe(0)
    const count = page.paths.length
    await expect(
      disposeProof(page, { ...command, nonce: "1123456789abcdef0123456789abcdef" }),
    ).rejects.toThrow()
    await disposeProof(page, command)
    expect(page.paths).toHaveLength(count)
    expect(page.removed).toEqual(["owned-widget-1"])
  }
})
test("同页导航或服务器CSRF改变不能把旧proof重新绑定给新交互", async () => {
  for (const change of ["navigation", "csrf"]) {
    const page = proofFixture(canonical)
    const command = { case: "replay", nonce } as const
    await installProof(page, command)
    page.callbacks[0]("local-owned-proof")
    const id = change === "navigation" ? "new-interaction" : "local-interaction"
    page.navigate(canonical.replace("local-interaction", id))
    page.serverInteraction({
      interactionId: id,
      realm: "User",
      csrf: "new-server-csrf",
      phase: "login",
    })
    const view = await readPasswordInteraction(page as unknown as Page)
    let requests = 0
    await expect(
      runNegative(page, command, view, async () => {
        requests++
        return new Response()
      }),
    ).rejects.toThrow()
    expect(requests).toBe(0)
    await disposeProof(page, command)
    expect(page.removed).toEqual(["owned-widget-1"])
  }
})

test("上下文校验RPC失败不回显CSRF或底层私密错误，也不发送密码请求", async () => {
  const page = proofFixture(canonical)
  const view = await readPasswordInteraction(page as unknown as Page)
  let requests = 0
  const failed = {
    evaluate: async () => {
      throw new Error("local-private-rpc-csrf")
    },
  }
  await expect(
    runNegative(failed, { case: "replay", nonce }, view, async () => {
      requests++
      return new Response()
    }),
  ).rejects.toThrow("当前OP上下文校验失败；未消费proof")
  expect(requests).toBe(0)
})

test("交互读取失败不传播浏览器请求或JSON解析的私密正文", async () => {
  for (const stage of ["request", "json"]) {
    const page = {
      url: () => canonical,
      request: {
        get: async () => {
          if (stage === "request") throw new Error("local-private-request")
          return {
            status: () => 200,
            json: async () => {
              throw new Error("local-private-body")
            },
          }
        },
      },
    } as unknown as Page
    await expect(readPasswordInteraction(page)).rejects.toThrow(
      stage === "request" ? "OP交互读取失败" : "OP交互响应无效",
    )
  }
})
