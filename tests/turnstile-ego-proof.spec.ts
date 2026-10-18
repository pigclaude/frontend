// 负责 proof ownership、不可替换、一次消费与真实序列化边界的本地协议测试。
import { test, expect } from "@playwright/test"
import { proofPage, type ProofCommand } from "./turnstile-ego-proof"
import { proofFixture } from "./turnstile-ego-fixture"

const nonce = "0123456789abcdef0123456789abcdef"
const otherNonce = "1123456789abcdef0123456789abcdef"
const command: ProofCommand = { operation: "install", case: "replay", nonce }

test("首个 proof 固定、晚回调不能替换，consume 只可一次", async () => {
  const page = proofFixture()
  expect((await page.evaluate(proofPage, command)).status).toBe("pending")
  page.callbacks[0]("")
  page.callbacks[0]("local-first-proof")
  page.advance(123)
  page.callbacks[0]("local-late-proof")
  const facts = await page.evaluate(proofPage, { ...command, operation: "facts" })
  expect(facts.ageMs).toBe(123)
  expect(JSON.stringify(facts)).not.toContain("proof")
  const consumed = await page.evaluate(proofPage, { ...command, operation: "consume" })
  expect(consumed.proof === "local-first-proof").toBe(true)
  await expect(page.evaluate(proofPage, { ...command, operation: "consume" })).rejects.toThrow()
})

test("过期 proof 306 秒之前不消耗，过期回调不删除首个 proof", async () => {
  const page = proofFixture()
  const expiry: ProofCommand = { ...command, case: "expiry" }
  await page.evaluate(proofPage, expiry)
  page.callbacks[0]("local-unused-expiry")
  page.advance(305_999)
  await expect(page.evaluate(proofPage, { ...expiry, operation: "consume" })).rejects.toThrow()
  expect((await page.evaluate(proofPage, { ...expiry, operation: "facts" })).status).toBe("ready")
  ;(page.options[0]["expired-callback"] as () => void)()
  page.advance(1)
  expect((await page.evaluate(proofPage, { ...expiry, operation: "consume" })).ageMs).toBe(306_000)
})

test("非expiry消费最多240000ms，旧proof拒绝后保留首个proof和owned实例", async () => {
  for (const caseName of ["replay", "wrong-action", "hostname"] as const) {
    for (const ageMs of [240_000, 240_001, 306_000]) {
      const page = proofFixture()
      const input = { ...command, case: caseName }
      await page.evaluate(proofPage, input)
      page.callbacks[0]("local-fixed-first-proof")
      page.advance(ageMs)
      page.callbacks[0]("local-replacement-must-be-ignored")
      if (ageMs === 240_000) {
        expect(
          (await page.evaluate(proofPage, { ...input, operation: "consume" })).proof ===
            "local-fixed-first-proof",
        ).toBe(true)
      } else {
        await expect(page.evaluate(proofPage, { ...input, operation: "consume" })).rejects.toThrow()
        const facts = await page.evaluate(proofPage, { ...input, operation: "facts" })
        expect(facts.status).toBe("ready")
        expect(facts.ageMs).toBe(ageMs)
        expect(page.removed).toEqual([])
      }
    }
  }
})

test("未知来源/场景/nonce 在 DOM 或配置请求前拒绝，dispose 只移除自有实例", async () => {
  const wrong = proofFixture("https://www.pigclaude.com")
  await expect(wrong.evaluate(proofPage, command)).rejects.toThrow()
  expect(wrong.nodes.length).toBe(0)
  expect(wrong.requests()).toBe(0)
  const page = proofFixture()
  await expect(
    page.evaluate(proofPage, { ...command, case: "secret" } as unknown as ProofCommand),
  ).rejects.toThrow()
  await expect(page.evaluate(proofPage, { ...command, nonce: "secret" })).rejects.toThrow()
  expect(page.nodes.length).toBe(0)
  expect(page.requests()).toBe(0)
  await page.evaluate(proofPage, command)
  await expect(
    page.evaluate(proofPage, { ...command, nonce: otherNonce, operation: "dispose" }),
  ).rejects.toThrow()
  expect(page.removed).toEqual([])
  await page.evaluate(proofPage, { ...command, operation: "dispose" })
  expect(page.removed).toEqual(["owned-widget-1"])
  await page.evaluate(proofPage, { ...command, nonce: otherNonce })
  page.callbacks[0]("stale-local-proof")
  expect(
    (await page.evaluate(proofPage, { ...command, nonce: otherNonce, operation: "facts" })).status,
  ).toBe("pending")
})

test("required正式四字段校验先于渲染，SDK仅使用内存回调且不自动刷新", async () => {
  for (const config of [
    { enabled: true, provider: "turnstile", mode: "required", siteKey: "1x00000000000000000000AA" },
    { enabled: true, provider: "turnstile", mode: "testing", siteKey: "local-key" },
    {
      enabled: true,
      provider: "turnstile",
      mode: "required",
      siteKey: "local-key",
      secretKey: "local-private",
    },
  ]) {
    const page = proofFixture()
    page.configure(config)
    await expect(page.evaluate(proofPage, command)).rejects.toThrow()
    expect(page.nodes.length).toBe(0)
  }
  for (const [caseName, origin, action] of [
    ["home-register", "https://pigclaude.com", "home_register"],
    ["replay", "https://pigclaude.com", "home_login"],
    ["admin-login", "https://admin.pigclaude.com", "admin_login"],
  ] as const) {
    const page = proofFixture(origin)
    await page.evaluate(proofPage, { ...command, case: caseName })
    expect(page.options[0].action).toBe(action)
    expect(page.options[0]["response-field"]).toBe(false)
    expect(page.options[0].retry).toBe("never")
    expect(page.options[0]["refresh-expired"]).toBe("never")
    expect(page.options[0].language).toBe("zh-cn")
  }
})
