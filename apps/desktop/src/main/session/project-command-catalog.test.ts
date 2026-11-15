// 验证启动 Claude Code 前只枚举当前工作目录到 Git 根的命令与 skill。

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { expect, it } from "vitest"
import { scanProjectCommands } from "./project-command-catalog"

it("命令按完整命名空间去重，兄弟目录和仓库外配置不参与", async () => {
  const folder = await mkdtemp(join(tmpdir(), "pigclaude-command-inventory-"))
  const repo = join(folder, "repo")
  const work = join(repo, "package")
  try {
    await mkdir(join(repo, ".git"), { recursive: true })
    for (const [root, path] of [
      [work, "commands/checks/close.md"],
      [repo, "commands/checks/close.md"],
      [repo, "commands/checks/open.md"],
      [repo, "skills/inspect/SKILL.md"],
      [repo, "skills/incomplete/readme.md"],
      [folder, "commands/outside.md"],
      [join(repo, "sibling"), "skills/sibling/SKILL.md"],
    ]) {
      if (!root || !path) throw new Error("测试数据缺少路径")
      const file = join(root, ".claude", path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, "synthetic")
    }
    const commands = await scanProjectCommands(work)
    expect(commands.map((item) => [item.name, item.kind])).toEqual([
      ["checks:close", "command"],
      ["checks:open", "command"],
      ["inspect", "skill"],
    ])
    expect(commands[0]?.file).toContain(join("package", ".claude"))
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
})
