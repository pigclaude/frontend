// 验证本次启动明确指定的扩展目录按浏览器参数顺序解析并核对。

import { mkdtemp, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join, sep } from "node:path"
import { expect, it } from "vitest"
import { expectedExtensionPaths } from "./browser-extension-paths"

it("核对最后一个扩展参数，并解析目录的真实路径", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-extension-paths-"))
  const alias = `${root}${sep}..${sep}${basename(root)}`
  try {
    await expect(
      expectedExtensionPaths(
        [`--load-extension=${root}-unused`, `--load-extension=${alias},${root}`],
        process.platform,
      ),
    ).resolves.toEqual([await realpath(root)])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it("不将终止符之后的内容误识别为扩展参数", async () => {
  await expect(
    expectedExtensionPaths(["--", "--load-extension=/missing-synthetic"], process.platform),
  ).resolves.toEqual([])
})

it("按照浏览器的边界空白规则识别扩展开关和终止符", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-extension-paths-"))
  try {
    await expect(
      expectedExtensionPaths([` \t--load-extension=${root} \t`], process.platform),
    ).resolves.toEqual([await realpath(root)])
    await expect(
      expectedExtensionPaths([" \t-- \t", "--load-extension=/missing-synthetic"], process.platform),
    ).resolves.toEqual([])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it("无法读取明确指定的扩展目录时失败且不泄露路径", async () => {
  const secretPath = join(tmpdir(), "synthetic-private-extension-missing")
  const result = expectedExtensionPaths([`--load-extension=${secretPath}`], process.platform)
  await expect(result).rejects.toThrow("指定的扩展目录不可用")
  await expect(result).rejects.not.toThrow(secretPath)
})

it("Windows 的扩展开关按不区分大小写的形式识别", async () => {
  const root = await mkdtemp(join(tmpdir(), "browser-extension-paths-"))
  try {
    await expect(expectedExtensionPaths([`/LOAD-EXTENSION=${root}`], "win32")).resolves.toEqual([
      await realpath(root),
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
