// 负责假易支付网关的真实 HTTP 协议、签名和 loopback 所有权边界回归。
import { test } from "node:test"
import assert from "node:assert/strict"
import { createServer } from "node:http"
import { createHash } from "node:crypto"
import { startFakeEpayGateway } from "../scripts/fake-epay-gateway.mjs"

function sign(params) {
  return createHash("md5")
    .update(
      Object.keys(params)
        .filter((k) => !["sign", "sign_type"].includes(k) && params[k])
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join("&") + "local-key",
    )
    .digest("hex")
}
async function fixture(t, redirect = false) {
  const received = []
  const server = createServer((req, res) => {
    received.push(new URL(req.url, "http://127.0.0.1"))
    if (redirect) res.writeHead(302, { location: "https://example.com/forbidden" }).end()
    else res.end("success")
  })
  await new Promise((done) => server.listen(0, "127.0.0.1", done))
  const home = `http://127.0.0.1:${server.address().port}`
  const gateway = await startFakeEpayGateway({
    host: "127.0.0.1",
    pid: "local-pid",
    key: "local-key",
    ownedOrigins: [home],
  })
  t.after(async () => {
    await gateway.close()
    server.closeAllConnections()
    await new Promise((done) => server.close(done))
  })
  const params = {
    pid: "local-pid",
    type: "alipay",
    out_trade_no: "PC12345678901234567890",
    money: "30.00",
    name: "会员 & 测试",
    notify_url: `${home}/notify`,
    return_url: `${home}/membership/paid`,
  }
  const create = async (changes = {}, path = "mapi.php") => {
    const body = { ...params, ...changes }
    body.sign = sign(body)
    body.sign_type = "MD5"
    return fetch(
      `${gateway.origin}/${path}${path === "submit.php" ? `?${new URLSearchParams(body)}` : ""}`,
      path === "submit.php" ? {} : { method: "POST", body: new URLSearchParams(body) },
    )
  }
  return { gateway, params, create, received }
}
test("mapi creates QR, api queries, pay sends independently verified signed notify", async (t) => {
  const f = await fixture(t)
  const created = await (await f.create()).json()
  assert.equal(created.code, 1)
  assert.equal(new URL(created.qrcode).origin, f.gateway.origin)
  const query = () =>
    fetch(
      `${f.gateway.origin}/api.php?${new URLSearchParams({ act: "order", pid: "local-pid", key: "local-key", out_trade_no: f.params.out_trade_no })}`,
    ).then((r) => r.json())
  assert.equal((await query()).status, 0)
  const paid = await fetch(`${f.gateway.origin}/__pay?order=${f.params.out_trade_no}`, {
    method: "POST",
  })
  assert.equal(paid.status, 200)
  const notification = Object.fromEntries(f.received[0].searchParams)
  assert.equal(notification.sign, sign(notification))
  assert.equal(notification.trade_status, "TRADE_SUCCESS")
  assert.equal(notification.money, "30.00")
  assert.equal((await query()).status, 1)
})
test("submit renders owned cashier with no credentials and supports local return", async (t) => {
  const f = await fixture(t)
  const response = await f.create({}, "submit.php")
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.ok(html.includes("/__pay?order="))
  assert.ok(!html.includes("local-key"))
})
test("reject external, unowned loopback and credential-bearing targets before any callback", async (t) => {
  const f = await fixture(t)
  for (const value of [
    "https://example.com/notify",
    "http://127.0.0.1:1/notify",
    "http://user@127.0.0.1/notify",
    "http://localhost:42/notify",
  ]) {
    for (const field of ["notify_url", "return_url"])
      assert.equal((await f.create({ [field]: value })).status, 400)
  }
  assert.equal(f.received.length, 0)
})
test("redirecting notify is rejected without following redirect", async (t) => {
  const f = await fixture(t, true)
  await f.create()
  assert.equal(
    (await fetch(`${f.gateway.origin}/__pay?order=${f.params.out_trade_no}`, { method: "POST" }))
      .status,
    502,
  )
  assert.equal(f.received.length, 1)
})
test("reject non-loopback binding, external origin and bad signatures", async (t) => {
  await assert.rejects(
    startFakeEpayGateway({ host: "0.0.0.0", pid: "x", key: "y", ownedOrigins: [] }),
    /BOUNDARY/,
  )
  await assert.rejects(
    startFakeEpayGateway({
      host: "127.0.0.1",
      pid: "x",
      key: "y",
      ownedOrigins: ["https://example.com"],
    }),
    /BOUNDARY/,
  )
  const f = await fixture(t)
  const response = await fetch(`${f.gateway.origin}/mapi.php`, {
    method: "POST",
    body: new URLSearchParams({ ...f.params, sign: "invalid" }),
  })
  assert.equal(response.status, 400)
  assert.equal(
    (
      await fetch(
        `${f.gateway.origin}/api.php?act=order&pid=local-pid&key=bad&out_trade_no=${f.params.out_trade_no}`,
      )
    ).status,
    403,
  )
})
