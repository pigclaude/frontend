// 负责验证生产门禁拒绝测试 key、宽松来源与证据秘密字段；不访问公网。
import { test, expect } from "@playwright/test"
import {
  validatePublicConfig,
  productionOrigin,
  safeEvidence,
} from "./turnstile-production-support"

test("生产来源必须精确匹配 HTTPS 四域名", () => {
  expect(productionOrigin("home")).toBe("https://www.pigclaude.com")
  expect(productionOrigin("www")).toBe("https://www.pigclaude.com")
  expect(productionOrigin("api")).toBe("https://api.pigclaude.com")
  expect(productionOrigin("admin")).toBe("https://admin.pigclaude.com")
})
test("公开配置严格四字段且拒绝测试key及额外字段", () => {
  const valid = { enabled: true, provider: "turnstile", mode: "required", siteKey: "real-site-key" }
  expect(validatePublicConfig(valid)).toBe(true)
  for (const siteKey of [
    "1x00000000000000000000AA",
    "2x00000000000000000000AB",
    "3x00000000000000000000FF",
    "",
  ]) {
    expect(validatePublicConfig({ ...valid, siteKey })).toBe(false)
  }
  expect(validatePublicConfig({ ...valid, secretKey: "must-not-appear" })).toBe(false)
  expect(validatePublicConfig({ ...valid, mode: "testing" })).toBe(false)
})
test("证据采用固定allowlist并拒绝未知字段", () => {
  expect(
    safeEvidence({
      status: 400,
      action: "admin_login",
      hostname: "admin.pigclaude.com",
      revision: "8",
    }),
  ).toEqual({ status: 400, action: "admin_login", hostname: "admin.pigclaude.com", revision: "8" })
  expect(() => safeEvidence({ token: "private" })).toThrow("证据包含未授权字段")
})

test("证据拒绝允许字段中的任意字符串、对象与越界值", () => {
  for (const value of [
    { step: "private-material" },
    { status: { private: true } },
    { status: 999 },
    { hostname: "elsewhere.test" },
    { action: "private-material" },
    { passed: "true" },
    { revision: "-1" },
    { revision: "9223372036854775808" },
  ])
    expect(() => safeEvidence(value)).toThrow("证据字段值无效")
})

test("WWW布尔Cookie证据可审计但拒绝秘密字符串", () => {
  expect(
    safeEvidence({
      hostname: "www.pigclaude.com",
      cookieSecure: true,
      cookieHttpOnly: true,
      cookieHostOnly: true,
    }),
  ).toEqual({
    hostname: "www.pigclaude.com",
    cookieSecure: true,
    cookieHttpOnly: true,
    cookieHostOnly: true,
  })
  expect(() => safeEvidence({ cookieSecure: "private" })).toThrow("证据字段值无效")
  expect(() => safeEvidence({ hostname: "api.pigclaude.com" })).toThrow("证据字段值无效")
})
