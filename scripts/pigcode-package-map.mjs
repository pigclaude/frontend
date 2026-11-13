// 负责定义 Pigcode 上游包与工作区目标包之间的映射，供同步与来源守卫共用。

/** 界面包的上游目录、目标目录和工作区包名。 */
export const vendoredPackages = [
  { source: "contracts", target: "ui-contracts", name: "@pigclaude/ui-contracts" },
  { source: "ui-primitives", target: "ui-primitives", name: "@pigclaude/ui-primitives" },
  { source: "ui-shell", target: "ui-shell", name: "@pigclaude/ui-shell" },
  { source: "ui-settings", target: "ui-settings", name: "@pigclaude/ui-settings" },
  { source: "ui-composer", target: "ui-composer", name: "@pigclaude/ui-composer" },
  { source: "ui-chat", target: "ui-chat", name: "@pigclaude/ui-chat" },
  { source: "client-runtime", target: "client-runtime", name: "@pigclaude/client-runtime" },
]
