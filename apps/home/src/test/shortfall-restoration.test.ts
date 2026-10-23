// 在隔离内存SQL适配器执行真实少收夹具收尾代码，验证任意失败恢复原值并关闭上下文。
// @vitest-environment node
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { expect, it } from "vitest"

it("shortfall fixture restores the captured nonzero value and closes on an interrupted assertion", async () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../../../tests/membership-local-readbacks.spec.ts", import.meta.url)),
    "utf8",
  )
  // 只执行当前用例的少收片段，浏览器与数据库访问均由隔离适配器代替。
  const start = source.indexOf("  const before = sql(")
  const end = source.indexOf('\ntest("activated return-only')
  const segment = source.slice(start, end).replace(/\n}\)\s*$/, "")
  const code = ts.transpileModule(segment, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  let value = "7"
  let closed = false
  const interruption = new Error("interrupted after shortfall write")
  const sql = (query: string) => {
    if (query.includes("UPDATE payment_orders")) {
      expect(query).toContain("order_no='PC12345678901234567890'")
      expect(query).toContain("user_id=(SELECT id FROM users WHERE email='owned@example.test')")
      value = query.match(/credit_shortfall_fen\s*=\s*'?([0-9]+)'?/)?.[1] ?? "invalid"
      return ""
    }
    if (query.includes("credit_shortfall_fen::text")) return value
    return JSON.stringify({
      orderNo: "PC12345678901234567890",
      status: "activated",
      shortfall: value,
    })
  }
  const run = new (Object.getPrototypeOf(async () => {}).constructor)(
    "sql",
    "admin",
    "expect",
    "record",
    "context",
    "order",
    "email",
    code,
  ) as (...args: unknown[]) => Promise<void>
  await expect(
    run(
      sql,
      {
        getByRole: () => ({
          click: async () => {
            throw interruption
          },
        }),
      },
      expect,
      () => {},
      {
        close: async () => {
          closed = true
        },
      },
      "PC12345678901234567890",
      "owned@example.test",
    ),
  ).rejects.toBe(interruption)
  expect(value).toBe("7")
  expect(closed).toBe(true)
})
