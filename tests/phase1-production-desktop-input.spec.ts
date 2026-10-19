// 负责以真实临时文件验证桌面验收私密输入的普通文件、精确权限与大小边界，不读取生产文件。
import { test, expect } from "@playwright/test"
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { desktopPrivateInputs } from "./phase1-production-desktop-support"

const fixture = {
  email: "fixture-email",
  password: "non-sensitive-fixture",
  adminAccount: "fixture-admin",
  adminPassword: "non-sensitive-fixture",
  planId: "fixture-plan",
}
const inputError = "桌面验收输入必须为权限0600的普通文件"

async function expectPrivateInputRejected(): Promise<void> {
  let rejected = false
  try {
    await desktopPrivateInputs()
  } catch (error) {
    rejected = error instanceof Error && error.message === inputError
  }
  expect(rejected).toBe(true)
}

async function withPrivateFixture(action: (directory: string, file: string) => Promise<void>) {
  const previous = process.env["PIGCLAUDE_DESKTOP_INPUT_FILE"]
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-d1-input-"))
  const file = join(directory, "input.json")
  try {
    await writeFile(file, JSON.stringify(fixture), { mode: 0o600 })
    process.env["PIGCLAUDE_DESKTOP_INPUT_FILE"] = file
    await action(directory, file)
  } finally {
    if (previous === undefined) delete process.env["PIGCLAUDE_DESKTOP_INPUT_FILE"]
    else process.env["PIGCLAUDE_DESKTOP_INPUT_FILE"] = previous
    await rm(directory, { recursive: true })
  }
}

test("私密输入接受真实普通0600文件且只在控制进程返回必需字段", async () => {
  await withPrivateFixture(async () => {
    const result = await desktopPrivateInputs()
    expect(Object.keys(result).sort()).toEqual(Object.keys(fixture).sort())
    expect(result.password === fixture.password && result.email === fixture.email).toBe(true)
  })
})

test("私密输入拒绝指向有效0600文件的符号链接", async () => {
  await withPrivateFixture(async (directory, file) => {
    const link = join(directory, "link.json")
    await symlink(file, link)
    process.env["PIGCLAUDE_DESKTOP_INPUT_FILE"] = link
    await expectPrivateInputRejected()
  })
})

for (const mode of [0o400, 0o700, 0o640, 0o1600, 0o4600]) {
  test(`私密输入拒绝非精确0600权限${mode.toString(8)}`, async () => {
    await withPrivateFixture(async (_directory, file) => {
      await chmod(file, mode)
      await expectPrivateInputRejected()
    })
  })
}

test("私密输入拒绝目录等非普通文件", async () => {
  await withPrivateFixture(async (directory) => {
    const folder = join(directory, "folder")
    await mkdir(folder, { mode: 0o700 })
    process.env["PIGCLAUDE_DESKTOP_INPUT_FILE"] = folder
    await expectPrivateInputRejected()
  })
})

test("私密输入拒绝超过64KiB的普通0600 JSON文件", async () => {
  await withPrivateFixture(async (_directory, file) => {
    await writeFile(file, JSON.stringify({ ...fixture, password: "x".repeat(65536) }))
    await expectPrivateInputRejected()
  })
})
