// 约定主窗口传入聊天页的会话、项目草稿、工作台和导航操作。

import type { ReactNode } from "react"
import type { ClaudeAccountView, ProxyView } from "@pigclaude/contracts/claude-account"
import type { WorkbenchBridge } from "../../../workbench-contract"
import type { ComposerReferenceRequest } from "../hooks/use-composer-reference"
import type { ProjectDraftEditor } from "../hooks/use-project-draft"
import type { SessionController } from "../hooks/use-session"
import type { NavLocation } from "../models/navigation"
import type { SavedSessionSummary } from "../models/saved-session"

/** 聊天页绘制草稿或会话所需的数据与事件。 */
export type ChatScreenProps = {
  fresh: boolean
  session: SessionController
  workspace: string | null
  /** workspace 所属的项目；workspace 是 worktree 时是它的项目，否则就是 workspace 本身。 */
  workspaceProject?: string | null
  workspaceOptions: string[]
  accounts: ClaudeAccountView[]
  proxies: ProxyView[]
  onPickWorkspace: () => void
  onSelectWorkspace: (path: string) => void
  /** 会话在 path 里开始了；project 是 path 所属的项目。 */
  onWorkspaceUsed: (path: string, project: string, sessionId?: string) => void
  /** 主窗口为新会话分配 id，使草稿启动和发送能跨导航保持原会话归属。 */
  identifySessions?: boolean
  /** 当前项目的草稿，离开聊天页也保留。 */
  projectDraft?: ProjectDraftEditor
  /** 当前选中的会话摘要；只有已保存会话有续接能力。 */
  summary?: SavedSessionSummary
  /** 续接失败时在原项目打开新草稿。 */
  onNewSession?: (projectId?: string) => void
  /** 当前草稿启动完成后，由窗口只有仍在这个草稿时切换。 */
  onDraftOpened?: (sessionId: string, project: string) => void
  /** 向这个聊天页的输入框插入侧栏选中的引用。 */
  referenceRequest?: ComposerReferenceRequest | undefined
  onOpen: (location: NavLocation) => void
  smartPunctuation: boolean
  layoutControls?: ReactNode
  /** 线程头的「在应用中打开」按钮；有项目时由调用方给出。 */
  openIn?: ReactNode
  onOpenFile?: (path: string) => void
  onViewDiff?: (path?: string) => void
  /** 草稿读写分支、新建 worktree 用的工作台桥；没有时草稿不显示分支控件。 */
  workbench?: WorkbenchBridge
}
