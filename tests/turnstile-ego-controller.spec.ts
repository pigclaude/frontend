// 负责固定 HTTP 序列与安全事实边界的本地传输验证；不存在真实 CF proof。
import { createServer } from "node:http"
import { test, expect } from "@playwright/test"
import { proofFixture } from "./turnstile-ego-fixture"
import { proofPage, type ProofReply } from "./turnstile-ego-proof"
import {
  installProof,
  readProofFacts,
  runNegative as runCurrentNegative,
} from "./turnstile-ego-controller"

const interaction = {
  interactionId: "local-interaction",
  realm: "User",
  csrf: "local-csrf",
  phase: "login",
} as const
const runNegative = (
  page: Parameters<typeof runCurrentNegative>[0],
  command: Parameters<typeof runCurrentNegative>[1],
  transport: Parameters<typeof runCurrentNegative>[3],
) => runCurrentNegative(page, command, interaction, transport)

const nonce = "0123456789abcdef0123456789abcdef"

test("真实 Node HTTP 夹具验证同 proof 401→400 且响应正文不会进入证据", async () => {
  const received: {
    captchaToken: string
    email: string
    password: string
    realm: string
    csrf: string
    mode: string
  }[] = []
  const server = createServer(async (request, response) => {
    let text = ""
    for await (const chunk of request) text += String(chunk)
    received.push(JSON.parse(text))
    response.writeHead(received.length === 1 ? 401 : 400)
    response.end("local-private-response")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("本地夹具端口无效")
  const page = proofFixture()
  const command = { case: "replay", nonce } as const
  await installProof(page, command)
  page.callbacks[0]("local-only-proof")
  try {
    const result = await runNegative(page, command, (url, init) => {
      expect(url).toBe(
        "https://www.pigclaude.com/v1/identity/interactions/local-interaction/password",
      )
      expect(init.redirect).toBe("error")
      return fetch(`http://127.0.0.1:${address.port}`, init)
    })
    expect(result.firstStatus).toBe(401)
    expect(result.replayStatus).toBe(400)
    expect(result.replayNoSetCookie).toBe(true)
    expect(received.length).toBe(2)
    expect(received[0].csrf).toBe(interaction.csrf)
    expect(received[0].realm).toBe("User")
    expect(received[0].mode).toBe("login")
    expect(received[0].captchaToken === received[1].captchaToken).toBe(true)
    expect(received[0].email === "negative@example.test").toBe(true)
    expect(received[0].password === "negative-password").toBe(true)
    expect(JSON.stringify(result)).not.toMatch(/local-only-proof|local-private-response/)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test("306秒前不消费不请求；达到边界后只首次提交一次400", async () => {
  const page = proofFixture()
  const command = { case: "expiry", nonce } as const
  let requests = 0
  await installProof(page, command)
  page.callbacks[0]("local-expiry-proof")
  page.advance(305_999)
  const transport = async () => {
    requests++
    return new Response("local", { status: 400 })
  }
  await expect(runNegative(page, command, transport)).rejects.toThrow()
  expect(requests).toBe(0)
  expect((await readProofFacts(page, command)).status).toBe("ready")
  page.advance(1)
  expect((await runNegative(page, command, transport)).firstStatus).toBe(400)
  expect(requests).toBe(1)
})

test("错误action只提交一次且 Set-Cookie 存在时拒绝假报通过", async () => {
  const page = proofFixture()
  const command = { case: "wrong-action", nonce } as const
  await installProof(page, command)
  expect(page.options[0].action).toBe("admin_login")
  page.callbacks[0]("local-wrong-action")
  let requests = 0
  await expect(
    runNegative(page, command, async () => {
      requests++
      return new Response("local", { status: 400, headers: { "set-cookie": "local=private" } })
    }),
  ).rejects.toThrow("真实拒绝场景失败")
  expect(requests).toBe(1)
  expect(page.removed).toEqual(["owned-widget-1"])
})

test("safe命名字段也拒绝任意字符串及多余proof，不传播底层秘密错误", async () => {
  const page = proofFixture()
  const command = { case: "replay", nonce } as const
  await installProof(page, command)
  const real = await page.evaluate(proofPage, { ...command, operation: "facts" })
  for (const changed of [
    { action: "local-secret" },
    { requestedHostname: "elsewhere.test" },
    { proof: "local-secret" },
  ]) {
    const invalid = { evaluate: async () => ({ ...real, ...changed }) as unknown as ProofReply }
    await expect(readProofFacts(invalid, command)).rejects.toThrow("Ego proof 状态读取失败")
  }
  page.callbacks[0]("local-secret-proof")
  await expect(
    runNegative(page, command, async () => {
      throw new Error("local-secret-proof")
    }),
  ).rejects.toThrow("真实拒绝场景失败；该项尚未验证")
})

test("非expiry旧proof含306000ms错误action在consume与请求前拒绝", async () => {
  for (const caseName of ["replay", "wrong-action"] as const) {
    for (const ageMs of [240_001, 306_000]) {
      const page = proofFixture()
      const command = { case: caseName, nonce }
      await installProof(page, command)
      page.callbacks[0]("local-stale-proof")
      page.advance(ageMs)
      let requests = 0
      await expect(
        runNegative(page, command, async () => {
          requests++
          return new Response("local", { status: caseName === "replay" ? 401 : 400 })
        }),
      ).rejects.toThrow()
      expect(requests).toBe(0)
      expect((await readProofFacts(page, command)).status).toBe("ready")
      expect(page.removed).toEqual([])
    }
  }
})

test("固定browser年龄的facts或consume RPC延迟仍耗尽Node预算且零请求", async () => {
  for (const delayedOperation of ["facts", "consume"] as const) {
    const fixture = proofFixture()
    const command = { case: "wrong-action", nonce } as const
    await installProof(fixture, command)
    fixture.callbacks[0]("local-delay-proof")
    fixture.advance(239_900)
    let consumes = 0
    const page = {
      evaluate: async (fn: typeof proofPage, argument: Parameters<typeof proofPage>[0]) => {
        if (argument.operation === "consume") consumes++
        const result = await fixture.evaluate(fn, argument)
        if (argument.operation === delayedOperation)
          await new Promise((resolve) => setTimeout(resolve, 150))
        return result
      },
    }
    let requests = 0
    await expect(
      runNegative(page, command, async () => {
        requests++
        return new Response("local", { status: 400 })
      }),
    ).rejects.toThrow()
    expect(requests).toBe(0)
    expect(consumes).toBe(delayedOperation === "facts" ? 0 : 1)
    expect((await readProofFacts(fixture, command)).status).toBe(
      delayedOperation === "facts" ? "ready" : "consumed",
    )
    expect(fixture.removed).toEqual([])
  }
})

test("fresh错误action保留有界dispatch年龄事实，首次400不含Cookie", async () => {
  const page = proofFixture()
  const command = { case: "wrong-action", nonce } as const
  await installProof(page, command)
  page.callbacks[0]("local-fresh-proof")
  page.advance(239_000)
  let requests = 0
  const result = await runNegative(page, command, async () => {
    requests++
    return new Response("local", { status: 400 })
  })
  expect(requests).toBe(1)
  expect(result.ageMs).toBe(239_000)
  expect(result.dispatchAgeMs).toBeGreaterThanOrEqual(239_000)
  expect(result.dispatchAgeMs).toBeLessThanOrEqual(240_000)
})

test("replay首次401响应延迟不延长同proof第二次提交预算", async () => {
  const page = proofFixture()
  const command = { case: "replay", nonce } as const
  await installProof(page, command)
  page.callbacks[0]("local-replay-with-response-delay")
  page.advance(239_900)
  let requests = 0
  await expect(
    runNegative(page, command, async () => {
      requests++
      await new Promise((resolve) => setTimeout(resolve, 150))
      return new Response("local", { status: 401 })
    }),
  ).rejects.toThrow()
  expect(requests).toBe(1)
  expect(page.removed).toEqual(["owned-widget-1"])
})

test("缺失当前交互CSRF时不消费proof也不发送请求", async () => {
  const page = proofFixture()
  const command = { case: "replay", nonce } as const
  await installProof(page, command)
  page.callbacks[0]("local-proof")
  let requests = 0
  await expect(
    runCurrentNegative(page, command, { ...interaction, csrf: "" }, async () => {
      requests++
      return new Response()
    }),
  ).rejects.toThrow("当前OP密码交互不可用")
  expect(requests).toBe(0)
  expect((await readProofFacts(page, command)).status).toBe("ready")
})
