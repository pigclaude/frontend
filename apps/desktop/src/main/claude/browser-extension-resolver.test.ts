// 验证浏览器返回的扩展路径按真实目录而非 Windows 短路径字符串比较。

import { expect, it } from "vitest"
import { matchingExtensionPaths } from "./browser-extension-resolver"

it("Windows 短路径和长路径指向同一目录时匹配", async () => {
  const expected = "C:\\Users\\runneradmin\\extension"
  const actual = "C:\\Users\\RUNNER~1\\extension"
  await expect(
    matchingExtensionPaths([expected], [actual], "win32", async () => expected),
  ).resolves.toBe(true)
})

it("其他扩展目录不可读时，不把缺失的目标扩展判为已加载", async () => {
  await expect(
    matchingExtensionPaths(["/synthetic/expected"], ["/synthetic/other"], "linux", async () => {
      throw new Error("synthetic inaccessible path")
    }),
  ).resolves.toBe(false)
})

it("目标目录已确认后，不等待无关扩展目录解析", async () => {
  await expect(
    matchingExtensionPaths(
      ["/synthetic/expected"],
      ["/synthetic/alias", "/synthetic/unrelated"],
      "linux",
      (path) =>
        path === "/synthetic/alias"
          ? Promise.resolve("/synthetic/expected")
          : new Promise<string>(() => undefined),
    ),
  ).resolves.toBe(true)
})

it("目标路径已直接匹配时不读取无关扩展目录", async () => {
  const read: string[] = []
  await expect(
    matchingExtensionPaths(
      ["/synthetic/expected"],
      ["/synthetic/unrelated", "/synthetic/expected"],
      "linux",
      async (path) => {
        read.push(path)
        return path
      },
    ),
  ).resolves.toBe(true)
  expect(read).toEqual(["/synthetic/expected"])
})

it("POSIX 下反斜杠和斜杠是不同目录", async () => {
  await expect(
    matchingExtensionPaths(["/synthetic/a\\b"], ["/synthetic/a/b"], "darwin", async (path) => path),
  ).resolves.toBe(false)
})

it("Windows 扩展路径支持大小写和 UNC 长路径形式", async () => {
  await expect(
    matchingExtensionPaths(
      ["\\\\server\\share\\extension"],
      ["\\\\?\\UNC\\SERVER\\SHARE\\extension"],
      "win32",
      async (path) => path,
    ),
  ).resolves.toBe(true)
})
