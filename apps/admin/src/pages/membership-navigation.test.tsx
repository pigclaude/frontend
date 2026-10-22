// 负责验证原后台分区标签仍能导航到真实设备页面。
import { fireEvent, render, screen } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { describe, expect, it, vi } from "vitest"
import MembershipPage from "./membership"
import DevicesPage from "./devices"

vi.mock("@/hooks/use-admin-me", () => ({
  useAdminMe: () => ({ data: { id: "admin", status: "active", permissions: ["membership:read"] } }),
}))
vi.mock("@/components/membership/members-section", () => ({
  MembersSection: () => <div>会员列表内容</div>,
}))
vi.mock("@/components/membership/devices-section", () => ({
  DevicesSection: () => <div>设备绑定内容</div>,
}))

describe("membership navigation", () => {
  it("navigates a section tab to its real route", async () => {
    render(
      <MemoryRouter initialEntries={["/membership"]}>
        <Routes>
          <Route path="/membership" element={<MembershipPage />} />
          <Route path="/devices" element={<DevicesPage />} />
        </Routes>
      </MemoryRouter>,
    )
    fireEvent.mouseDown(screen.getByRole("tab", { name: "设备绑定" }), {
      button: 0,
      ctrlKey: false,
    })
    expect(await screen.findByText("设备绑定内容")).toBeTruthy()
    expect(screen.getByRole("tab", { name: "设备绑定" }).getAttribute("aria-selected")).toBe("true")
  })
})
