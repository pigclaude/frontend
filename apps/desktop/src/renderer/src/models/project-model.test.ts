// 验证新增项目时的命名和去重。
import { describe, expect, it } from "vitest"
import { addProject, projectNameFromPath, type Project } from "./project-model"

const existing: Project[] = [{ id: "~/workspace/frontend", name: "frontend", sessions: [] }]

describe("project model", () => {
  it("项目名取路径最后一段，忽略结尾斜杠", () => {
    expect(projectNameFromPath("~/workspace/demo10/")).toBe("demo10")
    expect(projectNameFromPath("C:\\code\\api")).toBe("api")
    expect(projectNameFromPath("   ")).toBe("")
  })

  it("新项目放在最前，没有会话", () => {
    const result = addProject(existing, "~/workspace/demo10")
    expect(result[0]).toEqual({ id: "~/workspace/demo10", name: "demo10", sessions: [] })
    expect(result).toHaveLength(2)
  })

  it("空路径和重复路径不新增", () => {
    expect(addProject(existing, "")).toBe(existing)
    expect(addProject(existing, "~/workspace/frontend/")).toBe(existing)
  })
})
