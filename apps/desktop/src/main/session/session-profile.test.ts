// 负责验证会话入口把账号指纹里的空/system 时区和空语言归一成系统值，显式值原样保留。
// 同时覆盖启动会话和没有活动会话时的临时模型环境。

import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { systemLocale, systemTimezone } from "./session-locale"
import { createHarness } from "./session-host-fixtures"

const temporaryDirs: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe("session profile normalization", () => {
  it.each([
    ["empty", "", "", systemTimezone(), systemLocale()],
    ["system", "system", "", systemTimezone(), systemLocale()],
    ["explicit", "Asia/Tokyo", "ja-JP", "Asia/Tokyo", "ja-JP"],
  ])(
    "normalizes a %s profile before creating the session environment",
    async (label, timezone, locale, expectedTimezone, expectedLocale) => {
      const harness = createHarness({
        workspace: await workspaceDir(`start-${label}`),
        resolveProfile: { timezone, locale },
      })

      await harness.host.start({ workspace: harness.workspace, permissionMode: "default" })

      expect(harness.environments.inputs[0]).toMatchObject({
        timezone: expectedTimezone,
        locale: expectedLocale,
      })
      expect(harness.environments.inputs[0]?.timezone).not.toBe("")
      expect(harness.environments.inputs[0]?.locale).not.toBe("")
      await harness.host.dispose()
    },
  )

  it.each([
    ["empty", "", "", systemTimezone(), systemLocale()],
    ["system", "system", "", systemTimezone(), systemLocale()],
    ["explicit", "Asia/Tokyo", "ja-JP", "Asia/Tokyo", "ja-JP"],
  ])(
    "normalizes a %s profile for the temporary model environment",
    async (label, timezone, locale, expectedTimezone, expectedLocale) => {
      const harness = createHarness({
        workspace: await workspaceDir(`models-${label}`),
        resolveProfile: { timezone, locale },
      })

      await harness.host.models()

      expect(harness.environments.inputs[0]).toMatchObject({
        timezone: expectedTimezone,
        locale: expectedLocale,
      })
      expect(harness.environments.inputs[0]?.timezone).not.toBe("")
      expect(harness.environments.inputs[0]?.locale).not.toBe("")
      await harness.host.dispose()
    },
  )
})

async function workspaceDir(label: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `pigclaude-session-profile-${label}-`))
  temporaryDirs.push(dir)
  return dir
}
