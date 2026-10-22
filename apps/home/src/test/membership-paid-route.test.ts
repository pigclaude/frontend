// 负责验证支付回跳只保留合法订单号并固定使用 307。
import { expect, it } from "vitest"
import { GET } from "@/app/(app)/membership/paid/route"
it.each(["PC12345678901234567890", "bad", "PC12345678901234567890&next=evil", ""])(
  "drops gateway params and keeps only valid order: %s",
  (order) => {
    const response = GET(
      new Request(
        `https://home.example/membership/paid?order=${encodeURIComponent(order)}&sign=secret&next=https://evil.example`,
      ),
    )
    expect(response.status).toBe(307)
    expect(response.headers.get("location")).toBe(
      `https://home.example/membership${/^PC[0-9A-Z]{20}$/.test(order) ? `?order=${order}` : ""}`,
    )
  },
)

it("drops duplicate order parameters instead of choosing one", () => {
  const response = GET(
    new Request(
      "https://home.example/membership/paid?order=PC12345678901234567890&order=PC12345678901234567891",
    ),
  )
  expect(response.status).toBe(307)
  expect(response.headers.get("location")).toBe("https://home.example/membership")
})
