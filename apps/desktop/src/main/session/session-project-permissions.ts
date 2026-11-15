// 负责将一个会话绑定到本机项目授权。认证项目路径、启动时注入规则，并将变更热更新到活动会话。

import { realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { ProjectPermissionGrant } from "../../project-permissions-contract"
import { listWorkbenchWorktrees } from "../workbench/git-workspace"
import type { ClaudeAgentStartOptions } from "./claude-query-options"
import { canonicalProjectPath, containsProjectPath } from "./project-configuration-scope"
import type { ProjectPermissionSettings } from "./project-permission-grants"
import type { ProjectPermissionStore } from "./project-permission-store"
import type { SessionAdapterPort } from "./session-types"

/** 绑定到已验证的项目；只有这份会话的权限代理能新增授权。 */
export class SessionProjectPermissions {
  #detach?: () => void
  #closed = false
  #apply = Promise.resolve()

  /** 使用主进程核验过的规范路径创建会话绑定。 */
  constructor(
    private readonly store: ProjectPermissionStore,
    private readonly projectPath: string,
  ) {}

  /** 保存已选的 SDK 规则；当前请求结算后不再发起写入。 */
  readonly save = (grants: ProjectPermissionGrant[], active: () => boolean): Promise<void> =>
    this.store.grant(this.projectPath, grants, active)

  /** 在 SDK 启动时传入当前规则，再监听规则变更。 */
  async start(
    adapter: SessionAdapterPort,
    options: ClaudeAgentStartOptions,
    onFailure: () => void,
  ): Promise<void> {
    await adapter.start(options)
    if (this.#closed) return
    let notified = false
    const queue = (permissions: ProjectPermissionSettings): Promise<void> => {
      this.#apply = this.#apply
        .then(async () => {
          if (!this.#closed) await adapter.applyFlagSettings({ permissions })
        })
        .catch(() => {
          if (!this.#closed) onFailure()
        })
      return this.#apply
    }
    this.#detach = this.store.subscribe(this.projectPath, (permissions) => {
      notified = true
      return queue(permissions)
    })
    try {
      const current = await this.store.settings(this.projectPath)
      if (!notified && (current.allow?.length || current.additionalDirectories?.length)) {
        // 启动和热更新用同一层 flag，避免 CLI 启动参数保留撤销后的旧规则。
        queue(current)
      }
      await this.#apply
    } catch {
      onFailure()
    }
  }

  /** 解绑会话；结束后不再给这个 SDK 进程发送规则。 */
  close(): void {
    this.#closed = true
    this.#detach?.()
  }
}

/** 主目录与个人配置目录不能记住项目授权，分离的 worktree 必须由 Git 确认归属。 */
export async function permissionProjectPath(
  canonicalWorkspace: string,
  projectPath: string | undefined,
): Promise<string | null> {
  const home = (await canonicalProjectPath(homedir())) ?? homedir()
  const personal = (await canonicalProjectPath(join(home, ".claude"))) ?? join(home, ".claude")
  const allowed = (path: string): boolean => path !== home && !containsProjectPath(personal, path)
  if (!allowed(canonicalWorkspace)) return null
  if (projectPath === undefined) return canonicalWorkspace
  const project = await realpath(projectPath).catch(() => null)
  if (project === null || !allowed(project)) return canonicalWorkspace
  if (!(await stat(project).catch(() => null))?.isDirectory()) return canonicalWorkspace
  if (containsProjectPath(project, canonicalWorkspace)) return project
  for (const worktree of await listWorkbenchWorktrees(project)) {
    const path = await realpath(worktree.path).catch(() => null)
    if (path !== null && containsProjectPath(path, canonicalWorkspace)) return project
  }
  return canonicalWorkspace
}
