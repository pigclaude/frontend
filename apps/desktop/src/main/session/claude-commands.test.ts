// 验证 Claude Code 命令的公开列表：内置白名单、终端特有项以及同名时实际会执行的命令。

import { expect, it } from "vitest"
import { claudeCommands } from "./claude-commands"

it("保留项目命令和允许的内置命令，按 CLI 的同名优先规则解析", () => {
  const inputs = [
    { name: "context", builtin: true, description: "Context" },
    { name: "workflow", description: "Workflow" },
    { name: "review:files", description: "Project files", argumentHint: "<path>" },
    { name: "login", builtin: true },
    { name: "review", description: "Project review" },
    { name: "review", builtin: true },
    { name: "init", builtin: true },
    { name: "_hidden" },
    { name: "cost", builtin: true },
    { name: "panel" },
  ]
  expect(claudeCommands(inputs, ["init"])).toEqual([
    { name: "context", text: "/context", kind: "builtin", description: "Context" },
    {
      name: "review:files",
      text: "/review:files",
      kind: "skill",
      description: "Project files",
      argumentHint: "<path>",
    },
    { name: "workflow", text: "/workflow", kind: "skill", description: "Workflow" },
  ])
})
