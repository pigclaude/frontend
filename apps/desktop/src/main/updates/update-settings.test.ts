// 验证自动检查开关的保存：默认开启，写入后读回，文件损坏时按开启处理。
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { readAutoCheck, writeAutoCheck } from "./update-settings"

describe("自动检查开关", () => {
  let directory = ""
  afterEach(async () => {
    if (directory) await rm(directory, { recursive: true, force: true })
  })

  it("默认开启；保存后读回；文件损坏时按开启处理", async () => {
    directory = await mkdtemp(join(tmpdir(), "pigclaude-update-settings-"))
    const file = join(directory, "nested", "update-settings.json")
    expect(readAutoCheck(file)).toBe(true)
    await writeAutoCheck(file, false)
    expect(readAutoCheck(file)).toBe(false)
    await writeAutoCheck(file, true)
    expect(readAutoCheck(file)).toBe(true)
    await writeFile(file, "{not json")
    expect(readAutoCheck(file)).toBe(true)
  })
})
