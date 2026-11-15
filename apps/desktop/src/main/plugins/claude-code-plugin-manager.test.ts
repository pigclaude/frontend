// 用本机合成插件验证两种安装来源、披露绑定和会话独立副本。

import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { create } from "tar"
import { afterEach, expect, it } from "vitest"
import type { MembershipState } from "@pigclaude/contracts/membership"
import { CapabilityPluginManager } from "./capability-plugin-manager"
import { readCapabilityPluginArchive } from "./plugin-archive"

const id = "fixture-claude"
const packageManifest = ".claude-plugin/plugin.json"
const skill = "skills/lookup/SKILL.md"
const components = new Map([
  [
    packageManifest,
    JSON.stringify({
      name: id,
      version: "1.0.0",
      hooks: {},
      mcpServers: {},
      lspServers: {},
    }),
  ],
  ["commands/overview.md", "展示本机合成标题。\n"],
  ["agents/reader.md", "---\nname: reader\ndescription: 读取合成文字\n---\n读取合成文字。\n"],
  [skill, "---\r\nname: lookup\r\nallowed-tools: Read\r\n---\r\n读取本机合成数据。\r\n"],
  ["skills/lookup/notes.txt", "技能自己的资源。\n"],
  ["hooks/hooks.json", "{}"],
  [".mcp.json", "{}"],
  [".lsp.json", "{}"],
])
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-claude-code-plugin-"))
  roots.push(directory)
  const origin = join(directory, id)
  const userData = join(directory, "managed")
  for (const [name, value] of components) {
    const path = join(origin, name)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, value)
  }
  let membership: MembershipState = "active"
  const manager = new CapabilityPluginManager({
    root: userData,
    appVersion: "0.0.5",
    membership: () => membership,
    developerMode: () => true,
    readArchive: readCapabilityPluginArchive,
    stopInstances: () => undefined,
  })
  return {
    directory,
    origin,
    manager,
    owner: {},
    membershipChanged(state: MembershipState) {
      membership = state
      return manager.membershipChanged(state)
    },
  }
}

it("确认当时披露的 Claude Code 副本，启停和卸载只影响下一次启动", async () => {
  const f = await fixture()
  const disclosure = await f.manager.prepare({ kind: "directory", path: f.origin }, f.owner)
  expect(disclosure).toMatchObject({
    type: "claude-code",
    manifest: {
      id,
      commands: [id + ":overview"],
      skills: [id + ":lookup"],
      agents: [id + ":reader"],
      ignoredComponents: expect.arrayContaining(["hooks", "mcp", "lsp"]),
      skillExecution: [{ name: id + ":lookup", inline: false, hooks: false, allowedTools: true }],
    },
  })
  await writeFile(join(f.origin, skill), "确认前替换了来源文件。")
  await f.manager.confirm(disclosure.confirmationId, f.owner)
  await expect(f.manager.list()).resolves.toMatchObject([{ type: "claude-code", enabled: true }])
  await expect(f.manager.snapshotEnabled()).resolves.toEqual([])
  await expect(f.manager.claudeCodePluginCommands()).resolves.toEqual([
    id + ":overview",
    id + ":lookup",
  ])

  const current = join(f.directory, "current-session")
  await mkdir(current)
  await expect(f.manager.stageClaudeCodePlugins(current)).resolves.toEqual([join(current, id)])
  const packageDirectory = join(current, id)
  expect((await readdir(packageDirectory)).sort()).toEqual([
    ".claude-plugin",
    "agents",
    "commands",
    "skills",
  ])
  const sdkManifest = JSON.parse(await readFile(join(packageDirectory, packageManifest), "utf8"))
  for (const name of ["hooks", "mcpServers", "lspServers"])
    expect(sdkManifest).not.toHaveProperty(name)
  await expect(readFile(join(packageDirectory, skill), "utf8")).resolves.toBe(components.get(skill))
  await expect(readFile(join(packageDirectory, "skills/lookup/notes.txt"), "utf8")).resolves.toBe(
    components.get("skills/lookup/notes.txt"),
  )

  await f.manager.setEnabled(id, false)
  const next = join(f.directory, "next-session")
  await mkdir(next)
  await expect(f.manager.stageClaudeCodePlugins(next)).resolves.toEqual([])
  await expect(f.manager.claudeCodePluginCommands()).resolves.toEqual([])
  await f.manager.uninstall(id, false)
  await expect(f.manager.list()).resolves.toEqual([])
  await expect(readFile(join(packageDirectory, skill), "utf8")).resolves.toBe(components.get(skill))
})

it("归档按真实 SHA-256 绑定披露，会员无效后拒绝确认及会话加载", async () => {
  const f = await fixture()
  const path = join(f.directory, "bundle.tgz")
  await create({ cwd: f.directory, file: path, gzip: true }, [id])
  const sha256 = createHash("sha256")
    .update(await readFile(path))
    .digest("hex")
  await expect(
    f.manager.prepare({ kind: "archive", path, sha256: "0".repeat(64) }, f.owner),
  ).rejects.toThrow("PLUGIN_ARCHIVE_SHA256_MISMATCH")
  const disclosure = await f.manager.prepare({ kind: "archive", path, sha256 }, f.owner)
  expect(disclosure).toMatchObject({ type: "claude-code", sha256, manifest: { id } })
  await f.membershipChanged("expired")
  await expect(f.manager.confirm(disclosure.confirmationId, f.owner)).rejects.toThrow(
    "PLUGIN_CONFIRMATION_INVALID",
  )
  await f.membershipChanged("active")
  const available = await f.manager.prepare({ kind: "archive", path, sha256 }, f.owner)
  await f.manager.confirm(available.confirmationId, f.owner)
  await f.membershipChanged("network_grace")
  await expect(f.manager.claudeCodePluginCommands()).resolves.toEqual([])
  const session = join(f.directory, "session")
  await mkdir(session)
  await expect(f.manager.stageClaudeCodePlugins(session)).resolves.toEqual([])
})
