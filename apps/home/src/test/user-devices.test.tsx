// 负责验证本人设备的精确关系、近期核验、私有名称及迟到请求归属。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DeviceList } from "@/components/devices/device-list"
const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({
  usePathname: () => "/account/devices",
  useSearchParams: () => mocks.params,
}))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  return { homeClient: createClient({ fetch: mocks.fetch }), homeApi: {} }
})
const a = "pcd_" + "a".repeat(64)
const b = "pcd_" + "b".repeat(64)
const epoch = "9007199254740993"
function device(deviceId = a, displayName = "我的 Mac") {
  return {
    deviceId,
    displayName,
    platform: "macos",
    status: "active",
    bindingEpoch: epoch,
    firstAuthorizedAt: "2026-10-18T00:00:00Z",
    lastSeenAt: "2026-10-19T00:00:00Z",
    isCurrentDevice: null,
  }
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status })
}
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <DeviceList />
      </QueryClientProvider>,
    ),
  }
}
function posts() {
  return mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
}
async function choose(name = "撤销 我的 Mac") {
  const button = await screen.findByRole("button", { name })
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false))
  fireEvent.click(button)
}
beforeEach(() => {
  mocks.params = new URLSearchParams()
  mocks.fetch.mockReset().mockImplementation(async (url) => {
    if (String(url).startsWith("/v1/user/devices")) return json([device(), device(b, "我的 Linux")])
    if (String(url) === "/v1/user/identities")
      return json([{ provider: "github", display: "github · ••••", canUnlink: true }])
    if (String(url) === "/v1/session") return json({ csrf: "server-csrf" })
    if (String(url) === "/v1/auth/captcha")
      return json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
    return json({ type: "verified" })
  })
})
afterEach(cleanup)
describe("本人设备", () => {
  it("shows A and B using server names without inventing a website current device", async () => {
    mount()
    expect(await screen.findByText("我的 Mac")).toBeTruthy()
    expect(screen.getByText("我的 Linux")).toBeTruthy()
    expect(screen.getByText(a)).toBeTruthy()
    expect(screen.queryByText("当前设备")).toBeNull()
    expect(posts()).toHaveLength(0)
  })
  it("reauthenticates the exact lossless epoch before single revoke and preserves B", async () => {
    let revoked = false
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) => {
      if (String(url) === `/v1/user/devices/${a}/revoke`) {
        revoked = true
        return new Response(null, { status: 204 })
      }
      if (String(url).startsWith("/v1/user/devices"))
        return json([...(revoked ? [] : [device()]), device(b, "我的 Linux")])
      return original(url, init)
    })
    mount()
    await choose()
    expect(posts()).toHaveLength(0)
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "private-password" } })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "核验并继续" }).hasAttribute("disabled")).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "核验并继续" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByText("我的 Mac")).toBeNull()
    expect(screen.getByText("我的 Linux")).toBeTruthy()
    expect(posts().map(([url]) => url)).toEqual([
      "/v1/user/identities/reauth",
      `/v1/user/devices/${a}/revoke`,
    ])
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      method: "password",
      csrf: "server-csrf",
      password: "private-password",
      action: { operation: "revoke_device", device_id: a, expected_binding_epoch: epoch },
    })
    expect(JSON.parse(String(posts()[1][1]?.body))).toEqual({
      csrf: "server-csrf",
      expectedBindingEpoch: epoch,
    })
  })
  it("requires a distinct all-devices proof and keeps the website management session", async () => {
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url) === "/v1/user/devices/revoke-all"
        ? new Response(null, { status: 204 })
        : original(url, init),
    )
    mount()
    await choose("撤销全部设备")
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "password" } })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "核验并继续" }).hasAttribute("disabled")).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "核验并继续" }))
    await waitFor(() => expect(posts()).toHaveLength(2))
    expect(JSON.parse(String(posts()[0][1]?.body)).action).toEqual({
      operation: "revoke_all_devices",
    })
    expect(posts()[1][0]).toBe("/v1/user/devices/revoke-all")
    expect(JSON.parse(String(posts()[1][1]?.body))).toEqual({ csrf: "server-csrf" })
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).includes("logout"))).toBe(false)
  })
  it("keeps proof denial recoverable and refreshes stale epochs without replay", async () => {
    let writes = 0
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) => {
      if (String(url).endsWith("/revoke")) {
        writes++
        return json(
          { error: writes === 1 ? "access_denied" : "binding_conflict" },
          writes === 1 ? 403 : 409,
        )
      }
      return original(url, init)
    })
    mount()
    await choose()
    fireEvent.click(screen.getByRole("button", { name: "使用已有核验继续" }))
    expect((await screen.findByRole("alert")).textContent).toContain("重新核验")
    fireEvent.click(screen.getByRole("button", { name: "使用已有核验继续" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect((await screen.findByRole("alert")).textContent).toContain("已变化")
    expect(writes).toBe(2)
    expect(
      mocks.fetch.mock.calls.filter(([url]) => String(url).startsWith("/v1/user/devices?")).length,
    ).toBeGreaterThan(1)
  })
  it("renames only this account relation using PATCH with unchanged epoch", async () => {
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      init?.method === "PATCH" ? new Response(null, { status: 204 }) : original(url, init),
    )
    mount()
    await choose("命名 我的 Mac")
    fireEvent.change(screen.getByLabelText("设备名称"), { target: { value: "私人名称" } })
    fireEvent.click(screen.getByRole("button", { name: "保存名称" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    const call = mocks.fetch.mock.calls.find(([, init]) => init?.method === "PATCH")!
    expect(call[0]).toBe(`/v1/user/devices/${a}`)
    expect(JSON.parse(String(call[1]?.body))).toEqual({
      csrf: "server-csrf",
      displayName: "私人名称",
      expectedBindingEpoch: epoch,
    })
  })
  it.each(["bootstrap", "reauth"])("does not continue after unmount during %s", async (stage) => {
    const original = mocks.fetch.getMockImplementation()!
    let complete: (response: Response) => void = () => {}
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url) === (stage === "bootstrap" ? "/v1/session" : "/v1/user/identities/reauth")
        ? new Promise<Response>((resolve) => {
            complete = resolve
          })
        : original(url, init),
    )
    const view = mount()
    await choose()
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "password" } })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "核验并继续" }).hasAttribute("disabled")).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "核验并继续" }))
    await waitFor(() =>
      expect(
        mocks.fetch.mock.calls.some(
          ([url]) =>
            String(url) === (stage === "bootstrap" ? "/v1/session" : "/v1/user/identities/reauth"),
        ),
      ).toBe(true),
    )
    view.unmount()
    complete(json(stage === "bootstrap" ? { csrf: "old" } : { type: "verified" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(posts().some(([url]) => String(url).endsWith("/revoke"))).toBe(false)
  })
})

it.each(["single", "all"])(
  "uses only the bound provider to reauthenticate %s without auto-revoking",
  async (kind) => {
    const { identityManagementNavigation } =
      await import("@/components/identity/identity-management")
    const assign = vi.spyOn(identityManagementNavigation, "assign").mockImplementation(() => {})
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("/reauth")
        ? json({ type: "redirect", redirect: "https://provider.example/authorize?state=synthetic" })
        : original(url, init),
    )
    mount()
    await choose(kind === "all" ? "撤销全部设备" : "撤销 我的 Mac")
    expect(screen.queryByRole("button", { name: "使用已绑定 Google 核验" })).toBeNull()
    fireEvent.click(await screen.findByRole("button", { name: "使用已绑定 GitHub 核验" }))
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://provider.example/authorize?state=synthetic"),
    )
    expect(posts()).toHaveLength(1)
    expect(JSON.parse(String(posts()[0][1]?.body))).toEqual({
      method: "provider",
      provider: "github",
      csrf: "server-csrf",
      action:
        kind === "all"
          ? { operation: "revoke_all_devices" }
          : { operation: "revoke_device", device_id: a, expected_binding_epoch: epoch },
    })
    assign.mockRestore()
  },
)
it.each(["success", "failure"])(
  "ignores late %s after the business revoke was already sent",
  async (result) => {
    const original = mocks.fetch.getMockImplementation()!
    let complete: (value: Response) => void = () => {}
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("/revoke")
        ? new Promise<Response>((resolve) => {
            complete = resolve
          })
        : original(url, init),
    )
    const view = mount()
    const invalidate = vi.spyOn(view.client, "invalidateQueries")
    await choose()
    fireEvent.click(screen.getByRole("button", { name: "使用已有核验继续" }))
    await waitFor(() => expect(posts()).toHaveLength(1))
    view.unmount()
    view.client.setQueryData(["new-session"], { id: "new" })
    complete(
      result === "success"
        ? new Response(null, { status: 204 })
        : json({ error: "access_denied" }, 403),
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(invalidate).not.toHaveBeenCalled()
    expect(view.client.getQueryData(["new-session"])).toEqual({ id: "new" })
    expect(view.client.getMutationCache().getAll()).toHaveLength(0)
  },
)

it("loads every further device page without an account-wide device cap", async () => {
  const original = mocks.fetch.getMockImplementation()!
  const page = Array.from({ length: 50 }, (_, index) =>
    device("pcd_" + index.toString(16).padStart(64, "0"), `设备${index}`),
  )
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).startsWith("/v1/user/devices?")
      ? json(String(url).includes("afterDeviceId=") ? [device(b, "第51台设备")] : page)
      : original(url, init),
  )
  mount()
  fireEvent.click(await screen.findByRole("button", { name: "加载更多设备" }))
  expect(await screen.findByText("第51台设备")).toBeTruthy()
  expect(screen.getByText("设备0")).toBeTruthy()
  const request = mocks.fetch.mock.calls.find(([url]) => String(url).includes("afterDeviceId="))
  expect(String(request?.[0])).toContain(
    "afterDeviceId=pcd_0000000000000000000000000000000000000000000000000000000000000031",
  )
})
it("treats missing all-devices proof as a recoverable server denial", async () => {
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).endsWith("/revoke-all")
      ? json({ error: "access_denied" }, 403)
      : original(url, init),
  )
  mount()
  await choose("撤销全部设备")
  fireEvent.click(screen.getByRole("button", { name: "使用已有核验继续" }))
  expect((await screen.findByRole("alert")).textContent).toContain("重新核验")
  expect(screen.getByRole("dialog")).toBeTruthy()
  expect(posts()).toHaveLength(1)
  expect(posts()[0][0]).toBe("/v1/user/devices/revoke-all")
})
it.each(["", "a".repeat(65), "含\u0001控制字符"])(
  "does not send an invalid private name",
  async (name) => {
    mount()
    await choose("命名 我的 Mac")
    fireEvent.change(screen.getByLabelText("设备名称"), { target: { value: name } })
    expect(screen.getByRole("button", { name: "保存名称" }).hasAttribute("disabled")).toBe(true)
    expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
  },
)

it("keeps a new consumer pending when the old business request fails late", async () => {
  const original = mocks.fetch.getMockImplementation()!
  const completions: ((value: Response) => void)[] = []
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).endsWith("/revoke")
      ? new Promise<Response>((resolve) => {
          completions.push(resolve)
        })
      : original(url, init),
  )
  const old = mount()
  await choose()
  fireEvent.click(screen.getByRole("button", { name: "使用已有核验继续" }))
  await waitFor(() => expect(completions).toHaveLength(1))
  old.unmount()
  mount()
  await choose()
  fireEvent.click(screen.getByRole("button", { name: "使用已有核验继续" }))
  await waitFor(() => expect(completions).toHaveLength(2))
  completions[0](json({ error: "access_denied" }, 403))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.getByRole("button", { name: "使用已有核验继续" }).hasAttribute("disabled")).toBe(
    true,
  )
  expect(screen.queryByRole("alert")).toBeNull()
  completions[1](json({ error: "access_denied" }, 403))
  expect((await screen.findByRole("alert")).textContent).toContain("重新核验")
})
it("uses the next account private name for the same hardware without retaining a global alias", async () => {
  const first = mount()
  await screen.findByText("我的 Mac")
  first.unmount()
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).startsWith("/v1/user/devices?")
      ? json([device(a, "另一个账号私有名称")])
      : original(url, init),
  )
  mount()
  expect(await screen.findByText("另一个账号私有名称")).toBeTruthy()
  expect(screen.queryByText("我的 Mac")).toBeNull()
  expect(screen.getByText(a)).toBeTruthy()
})

it("invalidates the actual device consumer owner on a query-only route change", async () => {
  const original = mocks.fetch.getMockImplementation()!
  let complete: (response: Response) => void = () => {}
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url) === "/v1/session"
      ? new Promise<Response>((resolve) => {
          complete = resolve
        })
      : original(url, init),
  )
  const view = mount()
  await choose()
  fireEvent.click(screen.getByRole("button", { name: "使用已有核验继续" }))
  await waitFor(() =>
    expect(mocks.fetch.mock.calls.some(([url]) => String(url) === "/v1/session")).toBe(true),
  )
  mocks.params = new URLSearchParams("currentDeviceId=untrusted&identityResult=verified")
  view.rerender(
    <QueryClientProvider client={view.client}>
      <DeviceList />
    </QueryClientProvider>,
  )
  complete(json({ csrf: "old-route" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(posts()).toHaveLength(0)
})
