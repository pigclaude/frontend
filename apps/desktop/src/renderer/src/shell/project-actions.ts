// 负责侧栏项目右键菜单的重命名和移除：交给最近工作区控制器，失败时用提示告诉用户。
import type { WorkspacesController } from "../hooks/use-workspaces"
import type { TextKey } from "../locale/text"

/** 侧栏项目菜单的两个处理函数；移除成功后调用 onRemoved，失败时列表和显示名不变。 */
export function projectActions(input: {
  workspaces: Pick<WorkspacesController, "rename" | "remove">
  t: (key: TextKey) => string
  toast: (text: string, icon?: string) => void
  onRemoved: (path: string) => void
}): {
  onRenameProject: (path: string, name: string) => void
  onRemoveProject: (path: string) => void
} {
  return {
    onRenameProject: (path, name) => {
      void input.workspaces
        .rename(path, name)
        .catch(() => input.toast(input.t("shell.project.renameFailed"), "alert"))
    },
    onRemoveProject: (path) => {
      void input.workspaces
        .remove(path)
        .then(() => input.onRemoved(path))
        .catch(() => input.toast(input.t("shell.project.removeFailed"), "alert"))
    },
  }
}
