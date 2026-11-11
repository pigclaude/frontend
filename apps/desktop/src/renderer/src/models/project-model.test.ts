// 验证项目名取自文件夹名。
import { describe, expect, it } from "vitest"
import { projectNameFromPath } from "./project-model"

describe("project model", () => {
  it("项目名取路径最后一段，忽略结尾斜杠", () => {
    expect(projectNameFromPath("~/workspace/demo10/")).toBe("demo10")
    expect(projectNameFromPath("C:\\code\\api")).toBe("api")
    expect(projectNameFromPath("   ")).toBe("")
  })
})
