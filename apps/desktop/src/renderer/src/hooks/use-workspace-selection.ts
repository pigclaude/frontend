// 负责主窗口的工作目录选择：下一次会话用哪个目录、进行中的会话在哪个目录，以及 worktree 属于哪个项目。
// worktree 只记在这里和主进程的登记里，不写进最近项目列表，侧栏和草稿都按它所属的项目显示。
import { useCallback, useState } from "react"

/** 工作目录选择的状态和操作。 */
export type WorkspaceSelection = {
  /** 用户选的下一次会话目录；为 null 时用最近项目里的第一个。 */
  selected: string | null
  /** 进行中或刚结束的会话所在的目录。 */
  session: string | null
  /** 目录所属的项目：登记过的 worktree 返回它的项目，其他目录原样返回。 */
  projectOf: (path: string | null) => string | null
  /** 把 path 作为下一次会话的目录；为 null 时回到最近项目里的第一个。 */
  select: (path: string | null) => void
  /** 选用 from 所在项目的一个 worktree（或回到项目本身）作为下一次会话的目录。 */
  selectWorktree: (path: string, from: string | null) => void
  /** 会话在 path 里开始了：记下目录，把它所属的 project 放到最近项目最前。 */
  used: (path: string, project: string) => void
}

/** addProject 把项目放到最近项目最前；失败时不影响已经开始的会话。 */
export function useWorkspaceSelection(
  addProject: (path: string) => Promise<void>,
): WorkspaceSelection {
  const [selected, setSelected] = useState<string | null>(null)
  const [session, setSession] = useState<string | null>(null)
  const [owners, setOwners] = useState<Readonly<Record<string, string>>>({})

  const projectOf = useCallback(
    (path: string | null) => (path === null ? null : (owners[path] ?? path)),
    [owners],
  )

  function remember(path: string, project: string): void {
    if (path !== project) setOwners((current) => ({ ...current, [path]: project }))
  }

  return {
    selected,
    session,
    projectOf,
    select: setSelected,
    selectWorktree(path, from) {
      const project = projectOf(from)
      if (project !== null) remember(path, project)
      setSelected(path)
    },
    used(path, project) {
      remember(path, project)
      setSelected(path)
      setSession(path)
      void addProject(project).catch(() => undefined)
    },
  }
}
