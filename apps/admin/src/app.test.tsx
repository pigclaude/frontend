// 负责验证第一阶段管理后台的登录、权限守卫和受保护页面路由边界。
import { isValidElement } from "react"
import { describe, expect, it } from "vitest"
import { matchRoutes } from "react-router"
import { router } from "@/app"
import { AdminGuard } from "@/components/admin-guard"
import { AdminShell } from "@/components/shell/admin-shell"

describe("admin route guard", () => {
  it("puts users, membership, devices and audits under the guard and shell", () => {
    for (const path of ["/users", "/membership", "/devices", "/audits"]) {
      const matches = matchRoutes(router.routes, path)
      expect(matches).toHaveLength(3)
      expect(isValidElement(matches?.[0]?.route.element) && matches?.[0]?.route.element.type).toBe(
        AdminGuard,
      )
      expect(isValidElement(matches?.[1]?.route.element) && matches?.[1]?.route.element.type).toBe(
        AdminShell,
      )
    }
  })

  it("keeps login outside the protected shell", () => {
    const matches = matchRoutes(router.routes, "/login")
    expect(matches).toHaveLength(1)
    expect(
      isValidElement(matches?.[0]?.route.element) && matches?.[0]?.route.element.type,
    ).not.toBe(AdminGuard)
  })
})
