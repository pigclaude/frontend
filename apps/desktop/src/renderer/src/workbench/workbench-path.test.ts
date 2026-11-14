// 负责验证工作台路径换算：项目内相对路径和绝对路径互相转换，分隔符跟随项目目录。
import { describe, expect, it } from "vitest"
import { absoluteFilePath, workbenchRelativePath } from "./workbench-path"

describe("workbench paths", () => {
  it("joins a project file onto the project directory with its separator", () => {
    expect(absoluteFilePath("/Users/me/app/", "src/main.ts")).toBe("/Users/me/app/src/main.ts")
    expect(absoluteFilePath("C:\\work\\app", "src/main.ts")).toBe("C:\\work\\app\\src\\main.ts")
  })

  it("maps absolute paths inside the project back to relative ones and rejects the rest", () => {
    expect(workbenchRelativePath("/Users/me/app", "/Users/me/app/src/main.ts")).toBe("src/main.ts")
    expect(workbenchRelativePath("/Users/me/app", "/Users/me/other/main.ts")).toBeNull()
    expect(workbenchRelativePath("/Users/me/app", "../outside.txt")).toBeNull()
  })
})
