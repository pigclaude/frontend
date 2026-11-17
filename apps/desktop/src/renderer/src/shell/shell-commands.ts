// 负责把外壳的内置命令登记到 Command 扩展点：新会话、开合侧栏、开合右侧面板、设置、添加项目。
// 命令面板和输入框的 `/` 都从这里读，带 slash 的命令在输入框里就是 `/new`、`/panel`。
// 插件市场也是一个可以从命令面板打开的主应用页面。
import type {
  CommandContribution,
  ContributionOwner,
  ExtensionRegistry,
} from "@pigclaude/client-runtime"
import type { MessageKey } from "@pigclaude/ui-primitives"
import { pigclaudeProjectCommandNames } from "../../../project-configuration-contract"

/** 外壳命令需要的动作。 */
export type ShellCommandActions = {
  onNewSession: () => void
  onToggleSidebar: () => void
  onSettings: () => void
  onPlugins?: () => void
  onSchedules?: () => void
  onAddProject: () => void
  /** 开合右侧工作台，与 ⌘J 相同；没有工作台时不提供，面板和 `/panel` 都不出现。 */
  onToggleWorkbench?: () => void
  /** 现在能不能开合右侧工作台；和 ⌘J 一样只在会话页和新会话页可用。缺省为能。 */
  canToggleWorkbench?: () => boolean
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
      slash: pigclaudeProjectCommandNames.newSession,
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
    ...(actions.onToggleWorkbench
      ? [
          {
            id: "toggle-workbench",
            owner: { kind: "builtin", id: "workbench" },
            order: -40,
            title: { key: "palette.toggleWorkbench" },
            keywords: [t("palette.keywords.toggleWorkbench")],
            icon: "tray",
            shortcut: "Mod+j",
            slash: pigclaudeProjectCommandNames.workbench,
            available: () => actions.canToggleWorkbench?.() ?? true,
            run: () => actions.onToggleWorkbench?.(),
          } satisfies CommandContribution,
        ]
      : []),
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
    ...(actions.onPlugins
      ? [
          {
            id: "open-plugins",
            owner: shell,
            order: -20,
            title: { key: "settings.plugins" },
            icon: "cube",
            run: () => actions.onPlugins?.(),
          } satisfies CommandContribution,
        ]
      : []),
    ...(actions.onSchedules
      ? [
          {
            id: "open-schedules",
            owner: shell,
            order: -25,
            title: { key: "settings.schedules.pageTitle" },
            run: () => actions.onSchedules?.(),
          } satisfies CommandContribution,
        ]
      : []),
  ]
  const disposers = commands.map((command) => registry.register("command", command))
  return () => {
    for (const dispose of disposers) dispose()
  }
}
