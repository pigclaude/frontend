// 验证 renderer 导航模型的项目折叠和新会话保证。
import { describe, expect, it } from "vitest"
import { openNewSession, toggleProject } from "./navigation-model"

describe("renderer navigation model", () => {
  it("折叠项目时只改变项目展开状态", () => {
    expect(toggleProject("frontend", false)).toEqual({
      expandedProjects: { frontend: false },
    })
  })

  it("从项目创建新会话并保留项目上下文", () => {
    expect(openNewSession("frontend")).toEqual({
      screen: "chat-new",
      projectId: "frontend",
    })
  })
})
