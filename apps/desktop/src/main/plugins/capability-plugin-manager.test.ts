// 用原子副本和合成沙箱验证安装披露、会员门禁、卸载顺序及故障重试。

import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import type { MembershipState } from "@pigclaude/contracts/membership"
import { capabilityPluginManifestFile } from "../../capability-plugin-contract"
import {
  CapabilityPluginManager,
  type CapabilityPluginManagerOptions,
} from "./capability-plugin-manager"

const appVersion = "0.0.5"
const id = "example.report"
const owner = {}
const sha256 = "f".repeat(64)
const approvedSource = 'export default () => "approved";'
const changedSource = 'export default () => "changed";'
const manifest = {
  apiVersion: 1,
  id,
  name: "合成汇总",
  version: "1.0.0",
  pigclaudeVersion: "^0.0.5",
  entry: "dist/index.mjs",
  permissions: ["network", "secrets"],
  networkDomains: ["Api.Example.com"],
  tools: [{ name: "summarize", description: "合成工具", inputSchema: { type: "object" } }],
}
const paths: string[] = []

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "capability-plugin-test-"))
  paths.push(directory)
  const root = join(directory, "managed")
  const path = join(directory, "source")
  const entry = join(path, "dist", "index.mjs")
  await mkdir(join(path, "dist"), { recursive: true })
  await writeFile(join(path, capabilityPluginManifestFile), JSON.stringify(manifest))
  await writeFile(entry, approvedSource)
  await writeFile(join(path, "package.json"), '{"scripts":{"preinstall":"fixture"}}')
  let membership: MembershipState = "active"
  let developerMode = true
  const readArchive = vi.fn<CapabilityPluginManagerOptions["readArchive"]>(
    async () =>
      new Map([
        [capabilityPluginManifestFile, Buffer.from(JSON.stringify(manifest))],
        [manifest.entry, Buffer.from(approvedSource)],
      ]),
  )
  const stopInstances = vi.fn<CapabilityPluginManagerOptions["stopInstances"]>(
    async () => undefined,
  )
  const options = {
    root,
    appVersion,
    membership: () => membership,
    developerMode: () => developerMode,
    readArchive,
    stopInstances,
  } satisfies CapabilityPluginManagerOptions
  const manager = new CapabilityPluginManager(options)
  const prepare = () => manager.prepare({ kind: "directory", path }, owner)
  async function install() {
    const pending = await prepare()
    return manager.confirm(pending.confirmationId, owner)
  }
  return {
    root,
    path,
    entry,
    manager,
    options,
    install,
    prepare,
    readArchive,
    stopInstances,
    changeMembership(state: MembershipState) {
      membership = state
      return manager.membershipChanged(state)
    },
    disableDevelopment: () => {
      developerMode = false
    },
  }
}

it("绑定同一窗口的一次确认，并发布当时披露的域名和模块快照", async () => {
  const f = await fixture()
  const changes = vi.fn()
  f.manager.subscribe(changes)
  const preview = await f.prepare()
  expect(preview.manifest).toMatchObject({
    networkDomains: ["api.example.com"],
    tools: manifest.tools,
  })
  expect(await f.manager.list()).toEqual([])
  expect(changes).not.toHaveBeenCalled()
  await expect(f.manager.confirm(preview.confirmationId, {})).rejects.toThrow(
    "PLUGIN_CONFIRMATION_INVALID",
  )
  await writeFile(f.entry, changedSource)
  await writeFile(
    join(f.path, capabilityPluginManifestFile),
    JSON.stringify({
      ...manifest,
      networkDomains: ["other.example.com"],
    }),
  )
  const installed = await f.manager.confirm(preview.confirmationId, owner)
  expect(installed).toMatchObject({ enabled: true, approvedDomains: ["api.example.com"] })
  await expect(f.manager.confirm(preview.confirmationId, owner)).rejects.toThrow(
    "PLUGIN_CONFIRMATION_INVALID",
  )
  expect(changes).toHaveBeenCalledOnce()
  const [snapshot] = await f.manager.snapshotEnabled()
  expect(snapshot).toMatchObject({
    revision: installed.revision,
    approvedDomains: ["api.example.com"],
    modules: { [manifest.entry]: approvedSource },
  })
  await expect(
    readFile(join(f.root, "installed", id, "package", "package.json")),
  ).rejects.toMatchObject({
    code: "ENOENT",
  })
  expect(await new CapabilityPluginManager(f.options).list()).toEqual([installed])
})

it("开发目录在关闭开发模式后不能安装，归档必须把校验摘要交给归档读取器", async () => {
  const f = await fixture()
  const preview = await f.prepare()
  f.disableDevelopment()
  await expect(f.prepare()).rejects.toThrow("PLUGIN_DEVELOPER_MODE_REQUIRED")
  await expect(f.manager.confirm(preview.confirmationId, owner)).rejects.toThrow(
    "PLUGIN_DEVELOPER_MODE_REQUIRED",
  )
  const path = join(f.path, "bundle.zip")
  await expect(
    f.manager.prepare({ kind: "archive", path, sha256: "missing" }, owner),
  ).rejects.toThrow("PLUGIN_ARCHIVE_SHA256_INVALID")
  expect(f.readArchive).not.toHaveBeenCalled()
  const archive = await f.manager.prepare({ kind: "archive", path, sha256 }, owner)
  expect(f.readArchive).toHaveBeenCalledExactlyOnceWith(path, sha256)
  expect(await f.manager.confirm(archive.confirmationId, owner)).toMatchObject({
    sourceKind: "archive",
    sha256,
  })
})

it("旧记录默认逐次询问，偏好保存后重启仍使用相同安装版本", async () => {
  const f = await fixture()
  const installed = await f.install()
  const path = join(f.root, "installed", id, "record.json")
  const legacy = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>
  delete legacy.toolApproval
  await writeFile(path, JSON.stringify(legacy))

  const manager = new CapabilityPluginManager(f.options)
  await expect(manager.list()).resolves.toMatchObject([{ toolApproval: "always_ask" }])
  await expect(manager.setToolApproval(id, "follow_session")).resolves.toMatchObject({
    toolApproval: "follow_session",
    revision: installed.revision,
  })
  await expect(new CapabilityPluginManager(f.options).snapshotEnabled()).resolves.toMatchObject([
    { toolApproval: "follow_session", revision: installed.revision },
  ])
})

it("停用只影响新会话，会员失效禁止启用、作废披露并停止全部实例", async () => {
  const f = await fixture()
  const installed = await f.install()
  const preview = await f.prepare()
  await f.manager.setEnabled(id, false)
  expect(await f.manager.snapshotEnabled()).toEqual([])
  expect((await new CapabilityPluginManager(f.options).list())[0]?.enabled).toBe(false)
  expect(await f.manager.canInvoke(id, installed.revision)).toBe(true)
  const upgraded = new CapabilityPluginManager({ ...f.options, appVersion: "0.1.0" })
  expect((await upgraded.list())[0]?.compatible).toBe(false)
  await expect(upgraded.setEnabled(id, true)).rejects.toThrow("PLUGIN_VERSION_INCOMPATIBLE")
  expect(f.stopInstances).not.toHaveBeenCalled()
  await f.changeMembership("network_grace")
  expect(await f.manager.canInvoke(id, installed.revision)).toBe(false)
  expect(f.stopInstances).not.toHaveBeenCalled()
  await f.changeMembership("expired")
  expect(f.stopInstances).toHaveBeenCalledExactlyOnceWith()
  expect(await f.manager.canInvoke(id, installed.revision)).toBe(false)
  await expect(f.prepare()).rejects.toThrow("MEMBERSHIP_REQUIRED")
  await expect(f.manager.setEnabled(id, true)).rejects.toThrow("MEMBERSHIP_REQUIRED")
  await f.changeMembership("active")
  await expect(f.manager.confirm(preview.confirmationId, owner)).rejects.toThrow(
    "PLUGIN_CONFIRMATION_INVALID",
  )
  await expect(f.manager.setEnabled(id, true)).resolves.toMatchObject({ enabled: true })
})

it.each([true, false])(
  "卸载先撤销调用再清除副本、独立密钥和数据，保留数据=%s",
  async (keepData) => {
    const f = await fixture()
    const installed = await f.install()
    const [snapshot] = await f.manager.snapshotEnabled()
    if (!snapshot) throw new Error("没有安装快照")
    await mkdir(snapshot.dataDirectory, { recursive: true })
    const data = join(snapshot.dataDirectory, "data.json")
    await writeFile(data, '{"value":1}')
    const vault = dirname(snapshot.secretsFile)
    await mkdir(vault, { recursive: true })
    await writeFile(snapshot.secretsFile, '{"encrypted":"fixture"}')
    const temporary = join(vault, ".interrupted-write.tmp")
    await writeFile(temporary, '{"encrypted":"temporary-fixture"}')
    f.stopInstances.mockImplementation(async (pluginId) => {
      expect(pluginId).toBe(id)
      expect(await f.manager.canInvoke(id, installed.revision)).toBe(false)
      await expect(readFile(snapshot.secretsFile, "utf8")).resolves.toContain("encrypted")
    })
    await f.manager.uninstall(id, keepData)
    expect(f.stopInstances).toHaveBeenCalledOnce()
    expect(await f.manager.list()).toEqual([])
    await expect(readFile(snapshot.secretsFile)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(temporary)).rejects.toMatchObject({ code: "ENOENT" })
    await expect(readFile(join(f.root, "removing", id, "record.json"))).rejects.toMatchObject({
      code: "ENOENT",
    })
    if (keepData) await expect(readFile(data, "utf8")).resolves.toBe('{"value":1}')
    else await expect(readFile(data)).rejects.toMatchObject({ code: "ENOENT" })
  },
)

it("拒绝链接包；关闭实例失败后保持撤销并在下次打开时完成清理", async () => {
  const f = await fixture()
  const linked = join(f.path, "linked")
  await symlink(join(f.path, "dist"), linked, process.platform === "win32" ? "junction" : "dir")
  await expect(f.prepare()).rejects.toThrow("PLUGIN_BUNDLE_UNSAFE")
  await rm(linked, { force: true, recursive: true })
  const installed = await f.install()
  f.stopInstances.mockRejectedValueOnce(new Error("即将重新打开管理器"))
  await expect(f.manager.uninstall(id, true)).rejects.toThrow("即将重新打开管理器")
  expect(await f.manager.canInvoke(id, installed.revision)).toBe(false)
  expect(await new CapabilityPluginManager(f.options).list()).toEqual([])
  await expect(readFile(join(f.root, "removing", id, "record.json"))).rejects.toMatchObject({
    code: "ENOENT",
  })
})

it("并发确认同一插件时只发布一个完整版本", async () => {
  const f = await fixture()
  const otherWindow = {}
  const first = await f.prepare()
  await writeFile(f.entry, changedSource)
  const second = await f.manager.prepare({ kind: "directory", path: f.path }, otherWindow)
  const outcomes = await Promise.allSettled([
    f.manager.confirm(first.confirmationId, owner),
    f.manager.confirm(second.confirmationId, otherWindow),
  ])
  expect(outcomes[0]?.status).toBe("fulfilled")
  expect(outcomes[1]).toMatchObject({
    status: "rejected",
    reason: { message: "PLUGIN_ALREADY_INSTALLED" },
  })
  expect(await f.manager.list()).toHaveLength(1)
  expect((await f.manager.snapshotEnabled())[0]?.modules[manifest.entry]).toBe(approvedSource)
})
