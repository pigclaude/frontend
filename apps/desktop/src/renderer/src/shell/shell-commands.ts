// 负责把外壳的内置命令登记到 Command 扩展点：新会话、开合侧栏、设置、添加项目。
// Pigcode 的内置命令表固定带「插件」，PigClaude 没有插件，所以用同样的写法登记自己的这几条。
import type {
  CommandContribution,
  ContributionOwner,
  ExtensionRegistry,
} from "@pigclaude/pigcode-client-runtime"
import type { MessageKey } from "@pigclaude/pigcode-ui-primitives"

/** 外壳命令需要的动作。 */
export type ShellCommandActions = {
  onNewSession: () => void
  onToggleSidebar: () => void
  onSettings: () => void
  onAddProject: () => void
}

const shell: ContributionOwner = { kind: "builtin", id: "shell" }

/**
 * 登记外壳命令；返回注销函数。顺序就是命令面板「行动」组里的顺序，order 都小于 0，
 * 空的命令面板里按回车执行的是新会话。关键词随界面语言变化，语言变了由调用方重新登记。
 */
export function registerShellCommands(
  registry: ExtensionRegistry,
  actions: ShellCommandActions,
  t: (key: MessageKey) => string,
): () => void {
  const commands: CommandContribution[] = [
    {
      id: "new-thread",
      owner: shell,
      order: -60,
      title: { key: "nav.newThread" },
      keywords: [t("palette.keywords.newThread")],
      icon: "plus",
      shortcut: "Mod+n",
      slash: "new",
      run: () => actions.onNewSession(),
    },
    {
      id: "toggle-sidebar",
      owner: shell,
      order: -50,
      title: { key: "palette.toggleSidebar" },
      keywords: [t("palette.keywords.toggleSidebar")],
      icon: "sidebar",
      shortcut: "Mod+b",
      run: () => actions.onToggleSidebar(),
    },
    {
      id: "settings",
      owner: { kind: "builtin", id: "settings" },
      order: -30,
      title: { key: "settings.title" },
      keywords: [t("palette.keywords.settings")],
      icon: "gear",
      shortcut: "Mod+,",
      run: () => actions.onSettings(),
    },
    {
      id: "add-project",
      owner: { kind: "builtin", id: "projects" },
      order: -10,
      title: { key: "nav.addProject" },
      keywords: [t("palette.keywords.addProject")],
      icon: "folder-plus",
      run: () => actions.onAddProject(),
    },
  ]
  const disposers = commands.map((command) => registry.register("command", command))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
