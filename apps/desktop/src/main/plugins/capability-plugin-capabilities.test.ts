// 用真实安装记录和独立临时目录验证调用范围、存储配额和撤销权限。

import { link, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it, vi } from "vitest"
import type { MembershipState } from "@pigclaude/contracts/membership"
import {
  capabilityPluginManifestFile,
  type CapabilityPluginPermission,
} from "../../capability-plugin-contract"
import {
  createCapabilityPluginScope,
  type CapabilityPluginScopeOptions,
} from "./capability-plugin-capabilities"
import {
  CapabilityPluginManager,
  type CapabilityPluginManagerOptions,
  type CapabilityPluginSnapshot,
} from "./capability-plugin-manager"
import { createCapabilityPluginSecrets } from "./capability-plugin-secrets"
import { pluginSandboxPayloadLimit } from "./plugin-sandbox-contract"

const paths: string[] = []
const firstId = "fixture.one"

afterEach(async () => {
  await Promise.all(paths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it("并发作用域保存同一插件的 JSON，同名键按安装标识隔离", async () => {
  const f = await fixture()
  const installed = await f.install(firstId, ["storage"])
  const other = await f.install("fixture.two", ["storage"])
  const scope = f.scope(installed)
  const sibling = f.scope(installed)
  const separate = f.scope(other)
  expect(scope.methods).toEqual(["storage.get", "storage.set", "storage.delete"])
  await Promise.all([
    scope.request("storage.set", ["summary", { count: 3, parts: ["a", "b"] }], f.signal),
    sibling.request("storage.set", ["done", false], f.signal),
    separate.request("storage.set", ["summary", "另一个插件"], f.signal),
  ])
  await expect(sibling.request("storage.get", ["summary"], f.signal)).resolves.toEqual({
    count: 3,
    parts: ["a", "b"],
  })
  await expect(scope.request("storage.get", ["done"], f.signal)).resolves.toBe(false)
  await expect(separate.request("storage.get", ["summary"], f.signal)).resolves.toBe("另一个插件")
  await expect(sibling.request("storage.delete", ["done"], f.signal)).resolves.toBeNull()
  await expect(scope.request("storage.get", ["done"], f.signal)).resolves.toBeNull()
})

it("超出按编码字节计算的存储配额时保留已写的数据", async () => {
  const f = await fixture()
  const scope = f.scope(await f.install(firstId, ["storage"]))
  const value = "字".repeat(140_000)
  await scope.request("storage.set", ["first", value], f.signal)
  await scope.request("storage.set", ["second", value], f.signal)

  await expect(scope.request("storage.set", ["third", value], f.signal)).rejects.toThrow(
    "PLUGIN_CAPABILITY_DENIED",
  )
  await expect(scope.request("storage.get", ["first"], f.signal)).resolves.toBe(value)
  await expect(scope.request("storage.get", ["third"], f.signal)).resolves.toBeNull()
  await scope.request("storage.delete", ["second"], f.signal)
  await expect(scope.request("storage.set", ["third", value], f.signal)).resolves.toBeNull()
})

it("插件与设置页共用加密密钥，每个安装只访问自己的值", async () => {
  const f = await fixture()
  const first = await f.install(firstId, ["secrets"])
  const next = await f.install("fixture.two", ["secrets"])
  const scope = f.scope(first)
  await f.secrets.write(firstId, "fixtureKey", "由设置页保存的合成值")
  await expect(scope.request("secrets.get", ["fixtureKey"], f.signal)).resolves.toBe(
    "由设置页保存的合成值",
  )
  await expect(f.scope(next).request("secrets.get", ["fixtureKey"], f.signal)).resolves.toBeNull()
  await expect(
    scope.request("secrets.set", ["fixtureKey", "由工具保存的合成值"], f.signal),
  ).resolves.toBeNull()
  await expect(f.secrets.read(firstId, "fixtureKey")).resolves.toBe("由工具保存的合成值")
  expect(await readFile(first.secretsFile, "utf8")).not.toContain("由工具保存的合成值")
  await expect(scope.request("secrets.delete", ["fixtureKey"], f.signal)).resolves.toBeNull()
  await expect(f.secrets.read(firstId, "fixtureKey")).resolves.toBeNull()
})

it("只读当前工具工作区的普通相对文本，限制字节数并保留应用数据边界", async () => {
  const f = await fixture()
  const installed = await f.install(firstId, ["workspace-read"])
  await mkdir(join(f.workspace, "docs"))
  await writeFile(join(f.workspace, "docs", "notes.txt"), "合成说明")
  await writeFile(
    join(f.workspace, "oversized.txt"),
    Buffer.alloc(pluginSandboxPayloadLimit + 1, 97),
  )
  await writeFile(join(f.workspace, "binary.dat"), Buffer.from([0, 255]))
  await writeFile(join(f.userDataPath, "private-fixture.txt"), "独立的应用数据")

  const scope = f.scope(installed)
  expect(scope.methods).toEqual(["workspace.readText"])
  await expect(scope.request("workspace.readText", ["docs/notes.txt"], f.signal)).resolves.toBe(
    "合成说明",
  )
  for (const path of ["docs", "oversized.txt", "binary.dat"]) {
    await expect(scope.request("workspace.readText", [path], f.signal)).rejects.toThrow(
      "PLUGIN_CAPABILITY_DENIED",
    )
  }
  await link(join(f.workspace, "docs", "notes.txt"), join(f.workspace, "linked-notes.txt"))
  await expect(scope.request("workspace.readText", ["linked-notes.txt"], f.signal)).rejects.toThrow(
    "PLUGIN_CAPABILITY_DENIED",
  )

  const parent = f.scope(installed, { workspace: f.directory })
  await expect(
    parent.request("workspace.readText", ["app/private-fixture.txt"], f.signal),
  ).rejects.toThrow("PLUGIN_CAPABILITY_DENIED")
  const command = f.scope(installed, { workspace: null })
  expect(command.methods).toEqual([])
  await expect(command.request("workspace.readText", ["docs/notes.txt"], f.signal)).rejects.toThrow(
    "PLUGIN_CAPABILITY_DENIED",
  )
})

it("个人 Claude 配置不被家庭目录的工作区授权覆盖", async () => {
  const f = await fixture()
  const installed = await f.install(firstId, ["workspace-read"])
  const personal = join(f.directory, ".claude")
  const project = join(f.workspace, ".claude")
  await mkdir(personal)
  await mkdir(project)
  await writeFile(join(personal, "private-fixture.txt"), "个人合成配置")
  await writeFile(join(project, "project-fixture.txt"), "项目合成配置")
  vi.stubEnv("HOME", f.directory)
  vi.stubEnv("USERPROFILE", f.directory)
  try {
    const personalScope = f.scope(installed, { workspace: f.directory })
    await expect(
      personalScope.request("workspace.readText", [".claude/private-fixture.txt"], f.signal),
    ).rejects.toThrow("PLUGIN_CAPABILITY_DENIED")
    await expect(
      f.scope(installed).request("workspace.readText", [".claude/project-fixture.txt"], f.signal),
    ).resolves.toBe("项目合成配置")
  } finally {
    vi.unstubAllEnvs()
  }
})

it("严格匹配已声明方法与参数，插入只交给用户触发的命令", async () => {
  const f = await fixture()
  const installed = await f.install(firstId, ["notifications", "composer-insert"])
  const insertText = vi.fn<(text: string) => boolean>().mockReturnValue(true)
  const notify = vi
    .fn<(message: string) => boolean>()
    .mockReturnValueOnce(true)
    .mockReturnValue(false)
  const tool = f.scope(installed, { notify, insertText })
  expect(tool.methods).toEqual(["notifications.show"])
  await expect(tool.request("composer.insert", ["待插入的合成文字"], f.signal)).rejects.toThrow(
    "PLUGIN_CAPABILITY_DENIED",
  )
  const command = f.scope(installed, { workspace: null, notify, insertText })
  expect(command.methods).toEqual(["notifications.show", "composer.insert"])
  await expect(
    command.request("notifications.show", ["合成通知", "多余参数"], f.signal),
  ).rejects.toThrow("PLUGIN_CAPABILITY_DENIED")
  await expect(command.request("notifications.show", ["合成通知"], f.signal)).resolves.toBe(true)
  await expect(command.request("notifications.show", ["合成通知"], f.signal)).resolves.toBe(false)
  expect(notify.mock.calls).toEqual([["合成通知"], ["合成通知"]])
  await expect(command.request("composer.insert", ["仅插入草稿"], f.signal)).resolves.toBe(true)
  expect(insertText).toHaveBeenCalledExactlyOnceWith("仅插入草稿")
})

it("卸载与能力请求串行，重装后旧版本不能访问保留数据", async () => {
  const f = await fixture()
  const first = await f.install(firstId, ["storage"])
  const old = f.scope(first)
  await old.request("storage.set", ["retained", "原数据"], f.signal)
  const uninstall = f.manager.uninstall(firstId, true)
  const late = expect(old.request("storage.set", ["late", "过期调用"], f.signal)).rejects.toThrow(
    "PLUGIN_CAPABILITY_DENIED",
  )
  await uninstall
  await late
  const reinstalled = await f.install(firstId, ["storage"])
  expect(reinstalled.revision).not.toBe(first.revision)
  await expect(old.request("storage.get", ["retained"], f.signal)).rejects.toThrow(
    "PLUGIN_CAPABILITY_DENIED",
  )
  const scope = f.scope(reinstalled)
  await expect(scope.request("storage.get", ["retained"], f.signal)).resolves.toBe("原数据")
  await expect(scope.request("storage.get", ["late"], f.signal)).resolves.toBeNull()

  const cancelled = new AbortController()
  cancelled.abort()
  await expect(
    scope.request("storage.set", ["late", "已取消调用"], cancelled.signal),
  ).rejects.toThrow("PLUGIN_CANCELLED")
  await expect(scope.request("storage.get", ["late"], f.signal)).resolves.toBeNull()
})

it("会员在加密值发布前失效时保留旧密钥", async () => {
  const f = await fixture()
  const installed = await f.install(firstId, ["secrets"])
  await f.secrets.write(firstId, "fixtureKey", "原密钥")
  const scope = f.scope(installed, {
    secrets: {
      read: f.secrets.read.bind(f.secrets),
      write: (id, key, value, assertCurrent) =>
        f.secrets.write(id, key, value, () => {
          void f.changeMembership("expired")
          assertCurrent?.()
        }),
    },
  })
  await expect(
    scope.request("secrets.set", ["fixtureKey", "未提交的密钥"], f.signal),
  ).rejects.toThrow("PLUGIN_CAPABILITY_DENIED")
  await f.changeMembership("active")
  await expect(f.secrets.read(firstId, "fixtureKey")).resolves.toBe("原密钥")
})

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "pigclaude-capability-scope-")))
  paths.push(directory)
  const userDataPath = join(directory, "app")
  const workspace = join(directory, "workspace")
  await mkdir(workspace, { recursive: true })
  const root = join(userDataPath, "capability-plugins")
  const packages = new Map<string, ReadonlyMap<string, Buffer>>()
  let membership: MembershipState = "active"
  const stopInstances = vi
    .fn<CapabilityPluginManagerOptions["stopInstances"]>()
    .mockResolvedValue(undefined)
  const manager = new CapabilityPluginManager({
    root,
    appVersion: "0.0.5",
    membership: () => membership,
    developerMode: () => false,
    async readArchive(path) {
      const bundle = packages.get(path)
      if (!bundle) throw new Error("缺少合成包")
      return bundle
    },
    stopInstances,
  })
  const secrets = createCapabilityPluginSecrets(
    root,
    {
      getSelectedStorageBackend: () => "gnome_libsecret",
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(Buffer.from(value).map((byte) => byte ^ 0xa5)),
      decryptString: (value) => Buffer.from(value.map((byte) => byte ^ 0xa5)).toString(),
    },
    "linux",
  )
  return {
    workspace,
    directory,
    root,
    userDataPath,
    manager,
    secrets,
    stopInstances,
    changeMembership(state: MembershipState) {
      membership = state
      return manager.membershipChanged(state)
    },
    signal: new AbortController().signal,
    async install(id: string, permissions: CapabilityPluginPermission[]) {
      const path = join(directory, `${id}.zip`)
      packages.set(
        path,
        new Map([
          [
            capabilityPluginManifestFile,
            Buffer.from(
              JSON.stringify({
                apiVersion: 1,
                id,
                name: "合成插件 " + id,
                version: "1.0.0",
                pigclaudeVersion: "*",
                entry: "fixture.mjs",
                permissions,
              }),
            ),
          ],
          ["fixture.mjs", Buffer.from('export default () => "fixture"')],
        ]),
      )
      const owner = {}
      const disclosure = await manager.prepare(
        { kind: "archive", path, sha256: "a".repeat(64) },
        owner,
      )
      await manager.confirm(disclosure.confirmationId, owner)
      const snapshot = (await manager.snapshotEnabled()).find(({ manifest }) => manifest.id === id)
      if (!snapshot) throw new Error("缺少安装快照")
      return snapshot
    },
    scope(snapshot: CapabilityPluginSnapshot, options: Partial<CapabilityPluginScopeOptions> = {}) {
      return createCapabilityPluginScope({
        snapshot,
        manager,
        secrets,
        workspace,
        userDataPath,
        notify: () => false,
        ...options,
      })
    },
  }
}
