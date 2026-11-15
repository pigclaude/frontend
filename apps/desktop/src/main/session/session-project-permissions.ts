// 负责将一个会话绑定到本机项目授权。认证项目路径、启动时注入规则，并将变更热更新到活动会话。

import { homedir } from "node:os"
import { join } from "node:path"
import type { ProjectPermissionGrant } from "../../project-permissions-contract"
import { listWorkbenchWorktrees } from "../workbench/git-workspace"
import { WorktreeRegistry } from "../workbench/worktree-registry"
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
    hooks: { onFailure(): void; onRevokeFailure(): Promise<void> },
  ): Promise<void> {
    await adapter.start(options)
    if (this.#closed) return
    let notified = false
    const queue = (
      permissions: ProjectPermissionSettings,
      change: "grant" | "revoke",
    ): Promise<void> => {
      const update = this.#apply.then(async () => {
        if (this.#closed) return
        try {
          await adapter.applyFlagSettings({ permissions })
        } catch {
          if (this.#closed) return
          if (change === "revoke") {
            this.close()
            await hooks.onRevokeFailure()
          } else hooks.onFailure()
        }
      })
      this.#apply = update.catch(() => undefined)
      return update
    }
    this.#detach = this.store.subscribe(this.projectPath, (permissions, change) => {
      notified = true
      return queue(permissions, change)
    })
    try {
      const current = await this.store.settings(this.projectPath)
      if (!notified && (current.allow?.length || current.additionalDirectories?.length)) {
        // 启动和热更新用同一层 flag，避免 CLI 启动参数保留撤销后的旧规则。
        await queue(current, "grant")
      }
      await this.#apply
    } catch {
      hooks.onFailure()
    }
  }

  /** 解绑会话；结束后不再给这个 SDK 进程发送规则。 */
  close(): void {
    this.#closed = true
    this.#detach?.()
  }
}

/** 以实际工作区作为授权身份；共享授权须同时符合主进程工作树登记及当前 Git 记录。 */
export async function permissionProjectPath(
  canonicalWorkspace: string,
  userDataPath: string,
): Promise<string | null> {
  const home = (await canonicalProjectPath(homedir())) ?? homedir()
  const personal = (await canonicalProjectPath(join(home, ".claude"))) ?? join(home, ".claude")
  const allowed = (path: string): boolean => path !== home && !containsProjectPath(personal, path)
  if (!allowed(canonicalWorkspace)) return null
  const registry = new WorktreeRegistry({ filePath: join(userDataPath, "worktrees.json") })
  for (const [worktree, owner] of Object.entries(await registry.projects())) {
    if ((await canonicalProjectPath(worktree).catch(() => null)) !== canonicalWorkspace) continue
    const project = await canonicalProjectPath(owner).catch(() => null)
    if (project === null || !allowed(project) || project === canonicalWorkspace) continue
    const paths = new Set(
      await Promise.all(
        (await listWorkbenchWorktrees(project)).map(({ path }) =>
          canonicalProjectPath(path).catch(() => null),
        ),
      ),
    )
    if (paths.has(project) && paths.has(canonicalWorkspace)) return project
  }
  return canonicalWorkspace
}
