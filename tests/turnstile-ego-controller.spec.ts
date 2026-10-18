// 负责固定 HTTP 序列与安全事实边界的本地传输验证；不存在真实 CF proof。
import { createServer } from "node:http"
import { test, expect } from "@playwright/test"
import { proofFixture } from "./turnstile-ego-fixture"
import { proofPage, type ProofReply } from "./turnstile-ego-proof"
import { installProof, readProofFacts, runNegative } from "./turnstile-ego-controller"

const nonce = "0123456789abcdef0123456789abcdef"

test("真实 Node HTTP 夹具验证同 proof 401→400 且响应正文不会进入证据", async () => {
  const received: { captchaToken: string; email: string; password: string }[] = []
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
      expect(url).toBe("https://pigclaude.com/v1/auth/login")
      expect(init.redirect).toBe("error")
      return fetch(`http://127.0.0.1:${address.port}`, init)
    })
    expect(result.firstStatus).toBe(401)
    expect(result.replayStatus).toBe(400)
    expect(result.replayNoSetCookie).toBe(true)
    expect(received.length).toBe(2)
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
