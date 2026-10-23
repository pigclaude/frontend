// 负责验证目录、权益、报价和后台筛选路径，确保支付查询不依赖会员目录权限。
import { expect, it, vi } from "vitest"
import { createClient } from "../client"
import { createHomeApi } from "../home/endpoints"
import { createAdminApi } from "../admin/endpoints"
const json = (value: unknown) => new Response(JSON.stringify(value))
it("reads catalog, quotes, entitlement and encoded personal order through their exact paths", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({}))
  const api = createHomeApi(createClient({ fetch: fetcher })).membership
  await api.catalog()
  await api.quotes()
  await api.entitlement()
  await api.order("PC/a")
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/v1/membership/catalog",
    "/v1/membership/quotes",
    "/v1/entitlement",
    "/v1/membership/orders/PC%2Fa",
  ])
  expect(fetcher.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true)
})
it("payment-only order query consumes filterTiers without a membership directory request", async () => {
  const response = {
    items: [],
    nextCursor: null,
    filterTiers: [{ id: "deleted", name: "历史等级" }],
  }
  const fetcher = vi.fn<typeof fetch>(async (url) =>
    String(url).startsWith("/admin/v1/payment/orders")
      ? json(response)
      : new Response(null, { status: 403 }),
  )
  const api = createAdminApi(createClient({ fetch: fetcher }))
  expect(
    await api.membership.orders.list({
      q: "u+1",
      tierId: "deleted",
      from: "2026-10-22T10:00:00+08:00",
      to: "2026-10-23T10:00:00+08:00",
      needsReview: true,
      status: "pending",
      cursor: "opaque",
      limit: 20,
    }),
  ).toEqual(response)
  expect(fetcher).toHaveBeenCalledTimes(1)
  const url = new URL(String(fetcher.mock.calls[0][0]), "https://admin.test")
  expect(Object.fromEntries(url.searchParams)).toEqual({
    q: "u+1",
    tierId: "deleted",
    from: "2026-10-22T10:00:00+08:00",
    to: "2026-10-23T10:00:00+08:00",
    needsReview: "true",
    status: "pending",
    cursor: "opaque",
    limit: "20",
  })
})
it("keeps membership search separate from existing users and preserves nullable pagination", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ items: [], nextCursor: null }))
  const api = createAdminApi(createClient({ fetch: fetcher }))
  expect(
    await api.membership.memberships.list({ q: "a@b", status: "expired", tierId: "vip" }),
  ).toEqual({ items: [], nextCursor: null })
  await api.membership.users.search("a@b")
  await api.membership.tiers.list()
  await api.users.list()
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/admin/v1/memberships?q=a%40b&status=expired&tierId=vip",
    "/admin/v1/membership/users?q=a%40b",
    "/admin/v1/membership/tiers",
    "/admin/v1/users",
  ])
})
it("home order rejects a stale owner during bootstrap without creating an order", async () => {
  let complete: (value: Response) => void = () => {}
  let current = true
  const fetcher = vi.fn<typeof fetch>(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const request = createHomeApi(createClient({ fetch: fetcher })).membership.createOrder(
    { remainingUpgrade: { tierCode: "svip" }, payType: "wxpay" },
    () => current,
  )
  const assertion = expect(request).rejects.toMatchObject({ name: "StaleSessionResponse" })
  current = false
  complete(json({ csrf: "old" }))
  await assertion
  expect(fetcher).toHaveBeenCalledTimes(1)
})
it("payment settings reject unexpected secret-bearing response fields before returning cache data", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    json({
      revision: "1",
      enabled: false,
      gatewayUrl: "",
      pid: "",
      payTypes: [],
      notifyBaseUrl: "",
      keyConfigured: true,
      key: "must-not-cache",
    }),
  )
  await expect(
    createAdminApi(createClient({ fetch: fetcher })).settings.payment.view(),
  ).rejects.toThrow("支付设置响应格式无效")
})

it("reads own order history with cursor", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ items: [], nextCursor: null }))
  const api = createHomeApi(createClient({ fetch: fetcher })).membership
  await api.orders({ cursor: "c1", limit: 10 })
  await api.orders()
  expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
    "/v1/membership/orders?cursor=c1&limit=10",
    "/v1/membership/orders",
  ])
})
it("reads admin order summary", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({}))
  await createAdminApi(createClient({ fetch: fetcher })).membership.orders.summary()
  expect(fetcher.mock.calls[0][0]).toBe("/admin/v1/payment/orders/summary")
})
