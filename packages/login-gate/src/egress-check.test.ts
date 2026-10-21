// 出口核对测试。覆盖相等、不一致、失败、超时、解析失败和解析器。

import { describe, expect, it } from "vitest"
import { checkEgress, parseExitIp } from "./egress-check.ts"

const bridgeUrl = "http://127.0.0.1:1"
const upstreamProxyUrl = "http://127.0.0.1:2"
const checkUrl = "https://egress.test/trace"

describe("parseExitIp", () => {
  it("reads ip= lines, JSON and plain IPs", () => {
    expect(parseExitIp("fl=1\nip=203.0.113.42\nts=1")).toBe("203.0.113.42")
    expect(parseExitIp('{"ip":"198.51.100.7"}')).toBe("198.51.100.7")
    expect(parseExitIp("2001:db8::1")).toBe("2001:db8::1")
  })

  it("rejects empty, malformed and non-IP bodies", () => {
    expect(parseExitIp("")).toBeNull()
    expect(parseExitIp("not an ip")).toBeNull()
    expect(parseExitIp('{"ip":"nope"}')).toBeNull()
    expect(parseExitIp("{broken")).toBeNull()
  })
})

describe("checkEgress", () => {
  it("passes when both paths report the same IP", async () => {
    const result = await checkEgress({
      bridgeUrl,
      upstreamProxyUrl,
      checkUrl,
      fetch: sequenceFetch([
        () => Promise.resolve(text("ip=203.0.113.42")),
        () => Promise.resolve(text("ip=203.0.113.42")),
      ]),
    })
    expect(result).toEqual({ ok: true, ip: "203.0.113.42" })
  })

  it("fails when the bridge and upstream report different IPs", async () => {
    const result = await checkEgress({
      bridgeUrl,
      upstreamProxyUrl,
      checkUrl,
      fetch: sequenceFetch([
        () => Promise.resolve(text("ip=203.0.113.42")),
        () => Promise.resolve(text("ip=203.0.113.99")),
      ]),
    })
    expect(result).toEqual({ ok: false, reason: "mismatch", message: "请勿登录" })
  })

  it("does not fall back to the upstream path when the bridge fails", async () => {
    let calls = 0
    const result = await checkEgress({
      bridgeUrl,
      upstreamProxyUrl,
      checkUrl,
      fetch: sequenceFetch([
        () => {
          calls += 1
          return Promise.reject(new Error("bridge down"))
        },
      ]),
    })
    expect(result).toEqual({ ok: false, reason: "proxy", message: "请勿登录" })
    expect(calls).toBe(1)
  })

  it("reports timeouts separately from other proxy failures", async () => {
    const timeout = new Error("timed out")
    timeout.name = "TimeoutError"
    const result = await checkEgress({
      bridgeUrl,
      upstreamProxyUrl,
      checkUrl,
      fetch: sequenceFetch([() => Promise.reject(timeout)]),
    })
    expect(result).toEqual({ ok: false, reason: "timeout", message: "请勿登录" })
  })

  it("rejects bodies that do not contain a usable IP", async () => {
    const result = await checkEgress({
      bridgeUrl,
      upstreamProxyUrl,
      checkUrl,
      fetch: sequenceFetch([() => Promise.resolve(text("not an ip"))]),
    })
    expect(result).toEqual({ ok: false, reason: "parse", message: "请勿登录" })
  })

  it("treats a non-200 response as a proxy failure", async () => {
    const result = await checkEgress({
      bridgeUrl,
      upstreamProxyUrl,
      checkUrl,
      fetch: sequenceFetch([() => Promise.resolve(new Response("bad gateway", { status: 502 }))]),
    })
    expect(result).toEqual({ ok: false, reason: "proxy", message: "请勿登录" })
  })
})

function text(body: string): Response {
  return new Response(body, { status: 200 })
}

function sequenceFetch(responses: Array<() => Promise<Response>>): typeof import("undici").fetch {
  let index = 0
  const fake = async (): Promise<Response> => {
    const next = responses[index]
    index += 1
    if (next === undefined) throw new Error("unexpected fetch")
    return next()
  }
  return fake as unknown as typeof import("undici").fetch
}
