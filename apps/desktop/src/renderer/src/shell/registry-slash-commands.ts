// 负责把命令注册表里带 slash 的命令交给输入框的 `/` 菜单；输入框不另写一份命令。
import { useMemo } from "react"
import {
  contributionText,
  useContributions,
  type CommandContribution,
} from "@pigclaude/client-runtime"
import { useLocale, type MessageKey } from "@pigclaude/ui-primitives"
import type { ComposerCommand } from "@pigclaude/ui-composer"

/**
 * 把注册表命令转成输入框命令：只取带 slash 的，触发名就是 `/slash`，执行的是同一个 run，
 * 能不能执行也沿用注册表的判断。id 加前缀，不和输入框自己的命令（model、plan）撞上。
 */
export function slashCommands(
  commands: readonly CommandContribution[],
  t: (key: MessageKey) => string,
): ComposerCommand[] {
  return commands
    .filter((command) => command.slash !== undefined)
    .map((command) => ({
      id: `command-${command.id}`,
      label: `/${command.slash}`,
      description: contributionText(t, command.title),
      ...(command.keywords ? { keywords: command.keywords } : {}),
      available: command.available,
      run: () => void command.run(),
    }))
}

/** 当前注册表里的 `/` 命令；注册表变化时跟着变。 */
export function useSlashCommands(): ComposerCommand[] {
  const registered = useContributions("command")
  const { t } = useLocale()
  return useMemo(() => slashCommands(registered, t), [registered, t])
}
