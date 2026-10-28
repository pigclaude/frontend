// 负责通过真实安全审计页面和 HTTP 边界验证用户操作者显示及未知事实保留。
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { afterAll, beforeEach, expect, it, vi } from "vitest"
import type { ListMembershipAuditsResponse, MembershipAuditItem } from "@pigclaude/api/admin/types"
import AuditsPage from "./audits"

const fetcher = vi.hoisted(() => {
  const fetcher = vi.fn<typeof fetch>()
  vi.stubGlobal("fetch", fetcher)
  return fetcher
})

const credentialAudit: MembershipAuditItem = {
  id: "1",
  eventType: "user.password_changed",
  userId: "9007199254740993",
  deviceId: "",
  bindingEpoch: "",
  result: "success",
  reason: "",
  operatorType: "user",
  operatorId: "9007199254740993",
  clientIp: "",
  userAgent: "",
  createdAt: "2026-10-28T00:00:00Z",
}

function mount(items: MembershipAuditItem[]) {
  const response: ListMembershipAuditsResponse = { items, nextCursor: "0" }
  fetcher.mockImplementation(async (url) => {
    if (String(url) !== "/admin/v1/audits?limit=20") {
      throw new Error(`未预期的审计读取：${String(url)}`)
    }
    return new Response(JSON.stringify(response), {
      headers: { "content-type": "application/json" },
    })
  })
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter initialEntries={["/audits"]}>
        <AuditsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  fetcher.mockReset()
})
afterAll(() => {
  vi.unstubAllGlobals()
})

it("shows the user credential operator type and exact decimal ID returned by the admin API", async () => {
  mount([credentialAudit])

  const row = within(await screen.findByRole("row", { name: /user\.password_changed/ }))
  expect(row.getByText("user · 9007199254740993")).toBeTruthy()
  expect(row.getByText("9007199254740993")).toBeTruthy()
})

it.each(["user.password_changed", "legacy.unknown_event"])(
  "keeps an unknown operator for %s without inferring one from the target user",
  async (eventType) => {
    mount([
      {
        ...credentialAudit,
        eventType,
        operatorType: "unknown",
        operatorId: "",
      },
    ])

    const row = within(await screen.findByRole("row", { name: new RegExp(eventType) }))
    expect(row.getByText("unknown · —")).toBeTruthy()
    expect(row.getByText("9007199254740993")).toBeTruthy()
    expect(row.queryByText("user · 9007199254740993")).toBeNull()
  },
)
