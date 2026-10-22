// 负责验证会员 facade 的真实请求、服务端金额、编辑身份及会话隔离。
import { expect, it, vi } from "vitest"
import { createClient } from "../client"
import { createHomeApi } from "../home/endpoints"
import { createAdminApi } from "../admin/endpoints"
const json = (value: unknown) => new Response(JSON.stringify(value))
const grant = {
  userId: "u",
  tierId: "vip",
  durationUnit: "day" as const,
  duration: "1",
  valueFen: "0",
  remark: "授权",
}
const tier = {
  code: "vip",
  name: "VIP",
  level: 1,
  monthlyPriceFen: "9007199254740993",
  description: "",
  enabled: true,
  options: [
    {
      id: "original-option",
      months: 1,
      discountKind: "none" as const,
      discountValue: "0",
      enabled: true,
    },
  ],
}
it("create order sends body csrf and never computes amounts, preserving img-only payment", async () => {
  const response = {
    orderNo: "PC1",
    payableFen: "9007199254740993",
    expiresAt: "now",
    payment: { kind: "qr", qrcode: "", imageUrl: "https://pay.test/image" },
  }
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    json(String(url) === "/v1/session" ? { csrf: "home" } : response),
  )
  const api = createHomeApi(createClient({ fetch: fetcher }))
  expect(
    await api.membership.createOrder({ optionId: "o", payType: "alipay" }, () => true),
  ).toEqual(response)
  expect(fetcher.mock.calls[1][0]).toBe("/v1/membership/orders")
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    optionId: "o",
    payType: "alipay",
    csrf: "home",
  })
  expect(new Headers(fetcher.mock.calls[1][1]?.headers).has("X-CSRF-Token")).toBe(false)
})
it("admin grant uses header csrf", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ csrf: "admin" }))
  await createAdminApi(createClient({ fetch: fetcher })).membership.grants.create(grant)
  expect(fetcher.mock.calls[1][0]).toBe("/admin/v1/membership/grants")
  expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("X-CSRF-Token")).toBe("admin")
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual(grant)
})
it("payment settings save omits key when blank", async () => {
  const view = {
    revision: "2",
    enabled: false,
    gatewayUrl: "",
    pid: "",
    payTypes: [],
    notifyBaseUrl: "",
    keyConfigured: false,
  }
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    json(String(url).endsWith("session") ? { csrf: "admin" } : view),
  )
  const input = {
    expectedRevision: "1",
    enabled: false,
    gatewayUrl: "",
    pid: "",
    payTypes: [],
    notifyBaseUrl: "",
    key: "  ",
  }
  expect(
    await createAdminApi(createClient({ fetch: fetcher })).settings.payment.save(input),
  ).toEqual(view)
  expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({
    expectedRevision: "1",
    enabled: false,
    gatewayUrl: "",
    pid: "",
    payTypes: [],
    notifyBaseUrl: "",
  })
})
it("existing tier preview keeps immutable code while save omits it and retains original identity", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    json(
      String(url).endsWith("session")
        ? { csrf: "admin" }
        : {
            ...tier,
            id: "temporary",
            options: [
              {
                ...tier.options[0],
                id: "temporary-option",
                priceFen: "1",
                monthlyPurchaseFen: "1",
                savedFen: "0",
              },
            ],
          },
    ),
  )
  const api = createAdminApi(createClient({ fetch: fetcher })).membership
  await api.tiers.preview(tier)
  await api.tiers.save("original-tier", tier)
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method !== "GET")
  expect(JSON.parse(String(writes[0][1]?.body))).toEqual(tier)
  const saved = JSON.parse(String(writes[1][1]?.body))
  expect(writes[1][0]).toBe("/admin/v1/membership/tiers/original-tier")
  expect(saved).not.toHaveProperty("code")
  expect(saved.options[0].id).toBe("original-option")
  expect(tier.code).toBe("vip")
})
it("tier remove uses DELETE header csrf and accepts empty response", async () => {
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).endsWith("session") ? json({ csrf: "admin" }) : new Response(null, { status: 204 }),
  )
  await createAdminApi(createClient({ fetch: fetcher })).membership.tiers.remove("a/b")
  expect(fetcher.mock.calls[1][0]).toBe("/admin/v1/membership/tiers/a%2Fb")
  expect(fetcher.mock.calls[1][1]?.method).toBe("DELETE")
  expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("X-CSRF-Token")).toBe("admin")
})
it.each(["owner", "session"])(
  "tier remove rejects stale %s during bootstrap before mutation",
  async (boundary) => {
    let complete: (response: Response) => void = () => {}
    let current = true
    let generation = 0
    const fetcher = vi.fn<typeof fetch>(
      () =>
        new Promise((resolve) => {
          complete = resolve
        }),
    )
    const api = createAdminApi(createClient({ fetch: fetcher, generation: () => generation }))
    const request = api.membership.tiers.remove("vip", () => current)
    const assertion = expect(request).rejects.toMatchObject({ name: "StaleSessionResponse" })
    if (boundary === "owner") current = false
    else generation++
    complete(json({ csrf: "old" }))
    await assertion
    expect(fetcher).toHaveBeenCalledTimes(1)
  },
)

it("tier serialization excludes response-only fields without mutating editing IDs", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ csrf: "admin" }))
  const api = createAdminApi(createClient({ fetch: fetcher })).membership
  const editing = {
    ...tier,
    id: "existing",
    options: [{ ...tier.options[0], priceFen: "123", monthlyPurchaseFen: "234", savedFen: "111" }],
  }
  await api.tiers.preview(editing)
  await api.tiers.save(editing.id, editing)
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method !== "GET")
  expect(JSON.parse(String(writes[0][1]?.body))).toEqual(tier)
  const saved = {
    name: tier.name,
    level: tier.level,
    monthlyPriceFen: tier.monthlyPriceFen,
    description: tier.description,
    enabled: tier.enabled,
    options: tier.options,
  }
  expect(JSON.parse(String(writes[1][1]?.body))).toEqual(saved)
  expect(editing.id).toBe("existing")
  expect(editing.options[0].id).toBe("original-option")
})
