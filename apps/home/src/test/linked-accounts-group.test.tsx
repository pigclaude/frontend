// 负责验证第三方账号分组经真实身份 HTTP facade 完成近期核验、绑定、解绑与并发守卫。
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  LinkedAccountsGroup,
  linkedIdentitiesKey,
} from "@/components/account/linked-accounts-group"
import { identityManagement } from "@/components/identity/identity-management"

const mocks = vi.hoisted(() => ({ fetch: vi.fn<typeof fetch>(), params: new URLSearchParams() }))
vi.mock("next/navigation", () => ({ useSearchParams: () => mocks.params }))
vi.mock("@/lib/api", async () => {
  const { createClient } = await import("@pigclaude/api/client")
  return { homeClient: createClient({ fetch: mocks.fetch }), homeApi: {} }
})
function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status })
}
// 与页面一样从服务器读取真实列表，解绑后重新读取。
function Harness() {
  const list = useQuery({ queryKey: linkedIdentitiesKey, queryFn: identityManagement.list })
  return list.data ? <LinkedAccountsGroup identities={list.data} hasPassword /> : null
}
function mount() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness />
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  mocks.params = new URLSearchParams()
  mocks.fetch.mockReset().mockImplementation(async (url) => {
    if (String(url) === "/v1/user/identities")
      return json([{ provider: "github", display: "github · ••••", canUnlink: false }])
    if (String(url) === "/v1/session") return json({ csrf: "session-csrf" })
    if (String(url) === "/v1/auth/captcha")
      return json({ enabled: false, provider: "turnstile", siteKey: null, mode: "disabled" })
    return json({ type: "verified" })
  })
})
afterEach(cleanup)
describe("linked identities", () => {
  it("uses actual linked credentials and preserves the last available credential", async () => {
    mount()
    expect(await screen.findByText("github · ••••")).toBeTruthy()
    const blocked = screen.getByRole("button", { name: "解绑 GitHub" })
    // 保持可聚焦以便读出原因，但点击不会打开核验。
    expect(blocked.getAttribute("aria-disabled")).toBe("true")
    expect(blocked.hasAttribute("disabled")).toBe(false)
    fireEvent.click(blocked)
    expect(screen.queryByRole("dialog")).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "绑定 Google" }))
    expect(await screen.findByRole("dialog", { name: "近期身份核验" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "使用已绑定 GitHub 核验" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "使用已绑定 Google 核验" })).toBeNull()
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/google/link"))).toBe(false)
  })
  it("requires password reauthentication before linking and reports conflicts safely", async () => {
    const original = mocks.fetch.getMockImplementation()!
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url).endsWith("/google/link")
        ? json({ error: "identity_conflict", message: "secret upstream" }, 409)
        : original(url, init),
    )
    mount()
    await screen.findByText("github · ••••")
    fireEvent.click(screen.getByRole("button", { name: "绑定 Google" }))
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "old-password" } })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "核验并继续" }).hasAttribute("disabled")).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "核验并继续" }))
    expect((await screen.findByRole("alert")).textContent).toContain("已绑定其他账号")
    const writes = mocks.fetch.mock.calls.filter(([, init]) => init?.method === "POST")
    expect(writes.map(([url]) => url)).toEqual([
      "/v1/user/identities/reauth",
      "/v1/user/identities/google/link",
    ])
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({
      method: "password",
      csrf: "session-csrf",
      action: { operation: "link", provider: "google" },
      password: "old-password",
    })
    expect(JSON.parse(String(writes[1][1]?.body))).toEqual({ csrf: "session-csrf" })
    expect(screen.queryByText("secret upstream")).toBeNull()
  })
  it("never writes anything just by rendering the list", async () => {
    mount()
    await screen.findByText("github · ••••")
    expect(mocks.fetch.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(
      true,
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

it.each(["bootstrap", "reauth"])(
  "does not start the next sensitive HTTP stage after unmount during %s",
  async (stage) => {
    const original = mocks.fetch.getMockImplementation()!
    let complete: (value: Response) => void = () => {}
    mocks.fetch.mockImplementation(async (url, init) =>
      String(url) === (stage === "bootstrap" ? "/v1/session" : "/v1/user/identities/reauth")
        ? new Promise<Response>((resolve) => {
            complete = resolve
          })
        : original(url, init),
    )
    const view = mount()
    await screen.findByText("github · ••••")
    fireEvent.click(screen.getByRole("button", { name: "绑定 Google" }))
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
    complete(json(stage === "bootstrap" ? { csrf: "old-session" } : { type: "verified" }))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/google/link"))).toBe(false)
    if (stage === "bootstrap")
      expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/reauth"))).toBe(false)
  },
)

it("sends only an already-bound provider as reauthentication for the exact new target", async () => {
  const { identityManagementNavigation } = await import("@/components/identity/identity-management")
  const assign = vi.spyOn(identityManagementNavigation, "assign").mockImplementation(() => {})
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).endsWith("/reauth")
      ? json({
          type: "redirect",
          redirect: "https://provider.example/authorize?state=synthetic%2B%2520",
        })
      : original(url, init),
  )
  mount()
  await screen.findByText("github · ••••")
  fireEvent.click(screen.getByRole("button", { name: "绑定 Google" }))
  fireEvent.click(screen.getByRole("button", { name: "使用已绑定 GitHub 核验" }))
  await waitFor(() =>
    expect(assign).toHaveBeenCalledWith(
      "https://provider.example/authorize?state=synthetic%2B%2520",
    ),
  )
  const post = mocks.fetch.mock.calls.find(([url]) => String(url).endsWith("/reauth"))
  expect(JSON.parse(String(post?.[1]?.body))).toEqual({
    method: "provider",
    csrf: "session-csrf",
    action: { operation: "link", provider: "google" },
    provider: "github",
  })
  expect(mocks.fetch.mock.calls.some(([url]) => String(url).endsWith("/google/link"))).toBe(false)
  assign.mockRestore()
})
it("continuing with an existing proof still obeys the protected API denial", async () => {
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) =>
    String(url).endsWith("/google/link")
      ? json({ error: "access_denied" }, 403)
      : original(url, init),
  )
  mount()
  await screen.findByText("github · ••••")
  expect(mocks.fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false)
  fireEvent.click(screen.getByRole("button", { name: "绑定 Google" }))
  fireEvent.click(screen.getByRole("button", { name: "使用已有核验继续" }))
  expect((await screen.findByRole("alert")).textContent).toContain("请重新核验后重试")
  expect(screen.getByRole("dialog")).toBeTruthy()
})
it("posts strict DELETE csrf and rereads the actual list only after verified unlink success", async () => {
  let removed = false
  const original = mocks.fetch.getMockImplementation()!
  mocks.fetch.mockImplementation(async (url, init) => {
    if (String(url) === "/v1/user/identities")
      return json(
        removed ? [] : [{ provider: "github", display: "github · ••••", canUnlink: true }],
      )
    if (init?.method === "DELETE") {
      removed = true
      return json({ type: "unlinked" })
    }
    return original(url, init)
  })
  mount()
  await screen.findByText("github · ••••")
  fireEvent.click(screen.getByRole("button", { name: "解绑 GitHub" }))
  fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "password" } })
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "核验并继续" }).hasAttribute("disabled")).toBe(false),
  )
  fireEvent.click(screen.getByRole("button", { name: "核验并继续" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  expect(screen.queryByText("github · ••••")).toBeNull()
  const remove = mocks.fetch.mock.calls.find(([, init]) => init?.method === "DELETE")
  expect(remove?.[0]).toBe("/v1/user/identities/github")
  expect(JSON.parse(String(remove?.[1]?.body))).toEqual({ csrf: "session-csrf" })
  expect(mocks.fetch.mock.calls.filter(([url]) => url === "/v1/user/identities")).toHaveLength(2)
})

it("keeps the new page mutation pending when an old reauthentication fails and finalizes late", async () => {
  const original = mocks.fetch.getMockImplementation()!
  let failOld: (reason: Error) => void = () => {}
  let finishNew: (value: Response) => void = () => {}
  let count = 0
  mocks.fetch.mockImplementation(async (url, init) => {
    if (String(url).endsWith("/reauth")) {
      count++
      if (count === 1)
        return new Promise<Response>((_resolve, reject) => {
          failOld = reject
        })
      return new Promise<Response>((resolve) => {
        finishNew = resolve
      })
    }
    if (String(url).endsWith("/google/link")) return json({ error: "identity_conflict" }, 409)
    return original(url, init)
  })
  const view = mount()
  async function start() {
    await screen.findByText("github · ••••")
    fireEvent.click(screen.getByRole("button", { name: "绑定 Google" }))
    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "password" } })
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "核验并继续" }).hasAttribute("disabled")).toBe(
        false,
      ),
    )
    fireEvent.click(screen.getByRole("button", { name: "核验并继续" }))
  }
  await start()
  await waitFor(() => expect(count).toBe(1))
  view.rerender(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Harness key="new-page" />
    </QueryClientProvider>,
  )
  await start()
  await waitFor(() => expect(count).toBe(2))
  failOld(new Error("old secret error"))
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(screen.getByRole("button", { name: "核验并继续" }).hasAttribute("disabled")).toBe(true)
  expect(screen.queryByText("old secret error")).toBeNull()
  fireEvent.submit(document.querySelector("form")!)
  expect(count).toBe(2)
  finishNew(json({ type: "verified" }))
  expect((await screen.findByRole("alert")).textContent).toContain("已绑定其他账号")
})
