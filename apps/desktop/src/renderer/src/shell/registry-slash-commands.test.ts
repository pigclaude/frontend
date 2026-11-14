// 负责验证注册表命令到输入框 `/` 菜单的映射：只取带 slash 的命令，执行的是同一个 run。
import { describe, expect, it, vi } from "vitest"
import type { CommandContribution } from "@pigclaude/client-runtime"
import { slashCommands } from "./registry-slash-commands"

const owner = { kind: "builtin", id: "shell" } as const

function command(
  id: string,
  extra: { slash?: string; keywords?: readonly string[]; available?: () => boolean } = {},
  run: () => void = () => undefined,
): CommandContribution {
  return { id, owner, order: 0, title: { key: "nav.newThread" }, run, ...extra }
}

describe("slashCommands", () => {
  it("keeps only slash commands and runs the registry command itself", () => {
    const run = vi.fn()
    const available = () => false
    const mapped = slashCommands(
      [
        command("new-thread", { slash: "new", keywords: ["new"] }, run),
        command("settings"),
        command("toggle-workbench", { slash: "panel", available }),
      ],
      (key) => `t:${key}`,
    )

    expect(mapped.map(({ id, label, description }) => ({ id, label, description }))).toEqual([
      { id: "command-new-thread", label: "/new", description: "t:nav.newThread" },
      { id: "command-toggle-workbench", label: "/panel", description: "t:nav.newThread" },
    ])
    expect(mapped[0]?.keywords).toEqual(["new"])
    expect(mapped[1]?.available).toBe(available)
    mapped[0]?.run?.()
    expect(run).toHaveBeenCalledTimes(1)
  })
})
