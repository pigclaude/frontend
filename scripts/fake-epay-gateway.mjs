// 负责本任务独占的 loopback 易支付协议夹具；所有回调和返回目标必须预登记且禁止重定向。
import { createServer } from "node:http"
import { createHash, timingSafeEqual } from "node:crypto"

function signature(params, key) {
  return createHash("md5")
    .update(
      Object.keys(params)
        .filter((k) => !["sign", "sign_type"].includes(k) && params[k])
        .sort()
        .map((k) => `${k}=${params[k]}`)
        .join("&") + key,
    )
    .digest("hex")
}
function equal(a, b) {
  const left = Buffer.from(a ?? "")
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
function local(value) {
  const url = new URL(value)
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("FAKE_EPAY_BOUNDARY")
  return url
}
function params(search) {
  const result = {}
  for (const [key, value] of search) {
    if (Object.hasOwn(result, key)) throw new Error("FAKE_EPAY_REQUEST")
    result[key] = value
  }
  return result
}
/** 仅在显式 127.0.0.1 与自有 origins 上服务；不输出密钥、签名 URL 或请求原文。 */
export async function startFakeEpayGateway({ host, port = 0, pid, key, ownedOrigins }) {
  if (host !== "127.0.0.1" || !pid || !key || !ownedOrigins?.length)
    throw new Error("FAKE_EPAY_BOUNDARY")
  const origins = new Set(
    ownedOrigins.map((origin) => {
      const url = local(origin)
      if (url.pathname !== "/" || url.search) throw new Error("FAKE_EPAY_BOUNDARY")
      return url.origin
    }),
  )
  const target = (value) => {
    const url = local(value)
    if (!origins.has(url.origin)) throw new Error("FAKE_EPAY_BOUNDARY")
    return url
  }
  const orders = new Map()
  let origin
  const server = createServer(async (req, res) => {
    res.setHeader("cache-control", "no-store")
    const json = (status, value) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value))
    try {
      const url = new URL(req.url, origin)
      if (req.headers.host !== new URL(origin).host)
        return json(400, { error: "FAKE_EPAY_BOUNDARY" })
      if (["/mapi.php", "/submit.php"].includes(url.pathname)) {
        let input = url.searchParams
        if (url.pathname === "/mapi.php") {
          if (req.method !== "POST") return json(405, { error: "METHOD" })
          let body = ""
          for await (const chunk of req) {
            body += chunk.toString()
            if (body.length > 16384) throw new Error("FAKE_EPAY_REQUEST")
          }
          input = new URLSearchParams(body)
        }
        const p = params(input)
        if (
          p.pid !== pid ||
          !equal(p.sign, signature(p, key)) ||
          !/^PC[0-9A-Z]{20}$/.test(p.out_trade_no) ||
          !/^\d+\.\d{2}$/.test(p.money)
        )
          throw new Error("FAKE_EPAY_REQUEST")
        target(p.notify_url)
        target(p.return_url)
        const existing = orders.get(p.out_trade_no)
        if (existing && JSON.stringify(existing.params) !== JSON.stringify(p))
          throw new Error("FAKE_EPAY_REQUEST")
        if (!existing) orders.set(p.out_trade_no, { params: p, paid: false })
        if (url.pathname === "/mapi.php")
          return json(200, { code: 1, qrcode: `${origin}/cashier?order=${p.out_trade_no}` })
        return cashier(p.out_trade_no)
      }
      if (url.pathname === "/api.php") {
        const p = params(url.searchParams)
        if (p.pid !== pid || !equal(p.key, key)) return json(403, { error: "AUTH" })
        const order = orders.get(p.out_trade_no)
        if (p.act !== "order" || !order) return json(404, { code: 0 })
        return json(200, {
          code: 1,
          out_trade_no: p.out_trade_no,
          trade_no: `local-${p.out_trade_no}`,
          money: order.params.money,
          status: order.paid ? 1 : 0,
        })
      }
      const no = url.searchParams.get("order")
      const order = orders.get(no)
      if (!order) return json(404, { error: "ORDER" })
      if (url.pathname === "/cashier") return cashier(no)
      if (url.pathname === "/__pay" && req.method === "POST") {
        const notify = target(order.params.notify_url)
        target(order.params.return_url)
        const p = {
          pid,
          type: order.params.type,
          out_trade_no: no,
          trade_no: `local-${no}`,
          name: order.params.name,
          money: order.params.money,
          trade_status: "TRADE_SUCCESS",
        }
        p.sign = signature(p, key)
        p.sign_type = "MD5"
        for (const [k, v] of Object.entries(p)) notify.searchParams.set(k, v)
        const response = await fetch(notify, {
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
        })
        if (!response.ok || (await response.text()) !== "success")
          return json(502, { error: "NOTIFY_REJECTED" })
        order.paid = true
        return json(200, { paid: true })
      }
      if (url.pathname === "/return") {
        const back = target(order.params.return_url)
        back.searchParams.set("out_trade_no", no)
        res.writeHead(303, { location: back.href }).end()
        return
      }
      return json(404, { error: "NOT_FOUND" })
      function cashier(no) {
        res
          .writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "content-security-policy": "default-src 'none'; form-action 'self'; base-uri 'none'",
          })
          .end(
            `<!doctype html><html lang="zh"><title>本地测试收银台</title><h1>本地测试收银台</h1><form method="post" action="/__pay?order=${no}"><button>模拟付款</button></form><a href="/return?order=${no}">返回会员页</a></html>`,
          )
      }
    } catch {
      if (!res.headersSent) json(400, { error: "FAKE_EPAY_REQUEST_REJECTED" })
      else res.end()
    }
  })
  await new Promise((done, reject) => {
    server.once("error", reject)
    server.listen(port, host, done)
  })
  origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    close: async () => {
      server.closeAllConnections()
      await new Promise((done) => server.close(done))
    },
  }
}
