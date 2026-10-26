// 负责聊天页：空状态选工作区、开始会话、流式消息、工具折叠、权限回答、换号提示、
// 取消/停止和错误展示。页面只消费 useSession 控制器，不直接调用 preload。

import { useEffect, useState } from "react"
import {
  isAccountSelectable,
  type ClaudeAccountView,
  type ProxyView,
} from "@pigclaude/contracts/claude-account"
import { ChatDrawer } from "../components/chat/chat-drawer"
import { ChatEmpty } from "../components/chat/chat-empty"
import { ChatThread } from "../components/chat/chat-thread"
import { Composer, type ComposerSettings } from "../components/composer"
import type { PermissionMode, ThinkingDepth } from "../components/composer-options"
import { Icon } from "../components/icon"
import { Button } from "../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../components/ui/dialog"
import type { SessionController } from "../hooks/use-session"
import { projectNameFromPath } from "../models/project-model"
import type { Screen } from "./screen"

/** 会话页面 props。 */
export type ChatScreenProps = {
  fresh: boolean
  session: SessionController
  workspace: string | null
  workspaceOptions: string[]
  accounts: ClaudeAccountView[]
  proxies: ProxyView[]
  onPickWorkspace: () => void
  onSelectWorkspace: (path: string) => void
  onWorkspaceUsed: (path: string) => void
  onOpen: (screen: Screen) => void
  smartPunctuation: boolean
}

/** 绘制新会话空状态或进行中的会话。 */
export function ChatScreen({
  fresh,
  session,
  workspace,
  workspaceOptions,
  accounts,
  proxies,
  onPickWorkspace,
  onSelectWorkspace,
  onWorkspaceUsed,
  onOpen,
  smartPunctuation,
}: ChatScreenProps) {
  const [modelId, setModelId] = useState("")
  const [accountId, setAccountId] = useState("")
  const [depth, setDepth] = useState<ThinkingDepth>("medium")
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("default")
  const [pendingBypass, setPendingBypass] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const { state } = session
  const live = state.started && !state.ended
  const defaultModel = session.models.find((model) => model.isDefault) ?? session.models[0]
  const selectedModel = state.model ?? (modelId || defaultModel?.id || "")
  const activeMode = live ? state.permissionMode : permissionMode
  const activeAccount = live ? (state.accountId ?? "") : accountId
  const proxyUrls = new Map(proxies.map((proxy) => [proxy.id, proxy.url]))
  const availableAccounts = accounts.filter((account) =>
    isAccountSelectable(
      {
        enabled: account.enabled,
        needsReauth: account.needsReauth,
        hasCredential: account.credentialExpiresAt !== null,
        exhaustedUntil: account.exhaustedUntil,
        // 没有绑定代理时传 null 表示走系统网络；账号菜单和主进程选号器判断一致。
        proxyUrl: account.proxyId === null ? null : proxyUrls.get(account.proxyId),
      },
      Date.now(),
    ),
  )
  const error = localError ?? session.state.error?.message ?? null

  useEffect(() => {
    if (session.models.length > 0 || session.modelsLoading || session.modelsError !== null) return
    void session.refreshModels()
  }, [session.models.length, session.modelsLoading, session.modelsError, session.refreshModels])

  useEffect(() => {
    if (!live) setLocalError(null)
  }, [live])

  const composer: ComposerSettings = {
    model: selectedModel,
    modelOptions: session.models.map((model) => ({ id: model.id, label: model.displayName })),
    onModel: (next) => {
      setModelId(next)
      if (live) void session.setModel(next)
    },
    account: activeAccount,
    accountOptions: availableAccounts.map((account) => ({
      id: account.id,
      label: account.displayName,
    })),
    onAccount: (next) => {
      if (live) {
        setLocalError("会话开始后不支持换号")
        return
      }
      setLocalError(null)
      setAccountId(next)
    },
    showAccount: true,
    depth,
    onDepth: setDepth,
    permissionMode: activeMode,
    onPermissionMode: chooseMode,
    disabled: live && state.activeTurnId !== null,
    smartPunctuation,
  }

  function chooseMode(next: PermissionMode): void {
    setLocalError(null)
    if (!live) {
      setPermissionMode(next)
      return
    }
    if (next === "bypassPermissions") {
      setPendingBypass(true)
      return
    }
    void session.setMode(next)
  }

  async function startSession(target: string): Promise<boolean> {
    const ok = await session.start({
      workspace: target,
      ...(selectedModel === "" ? {} : { model: selectedModel }),
      thinking: depth,
      permissionMode,
      ...(accountId === "" ? {} : { accountId }),
    })
    if (ok) {
      onWorkspaceUsed(target)
      if (fresh) onOpen("chat")
    }
    return ok
  }

  async function startOnly(): Promise<void> {
    if (live) return
    const target = workspace ?? workspaceOptions[0] ?? null
    if (target === null) {
      setLocalError("先选择一个工作区")
      return
    }
    setLocalError(null)
    await startSession(target)
  }

  async function submit(text: string): Promise<boolean> {
    if (live) {
      if (state.activeTurnId !== null) {
        setLocalError("当前请求尚未结束")
        return false
      }
      setLocalError(null)
      return session.send(text)
    }
    const target = workspace ?? workspaceOptions[0] ?? null
    if (target === null) {
      setLocalError("先选择一个工作区")
      return false
    }
    setLocalError(null)
    const ok = await startSession(target)
    if (!ok) return false
    return session.send(text)
  }

  if (!live) {
    return (
      <>
        <ChatEmpty
          workspace={workspace}
          workspaceOptions={workspaceOptions}
          composer={composer}
          modelsLoading={session.modelsLoading}
          modelsError={session.modelsError}
          error={error}
          onPickWorkspace={onPickWorkspace}
          onSelectWorkspace={(path) => {
            setLocalError(null)
            onSelectWorkspace(path)
          }}
          onStart={() => void startOnly()}
          onSubmit={submit}
          onRetryModels={() => void session.refreshModels(true)}
          onCancelModels={session.cancelModels}
          onOpen={onOpen}
        />
        <BypassDialog
          open={pendingBypass}
          onOpenChange={setPendingBypass}
          onConfirm={() => {
            setPermissionMode("bypassPermissions")
            setPendingBypass(false)
            if (live) void session.setMode("bypassPermissions")
          }}
        />
      </>
    )
  }

  const waiting = state.turns.some((turn) => turn.status === "waiting")
  const statusText = state.ended ? "已结束" : waiting ? "等待许可" : "运行中"
  return (
    <section className="view">
      <div className="panel-top">
        <div className="title">
          <Icon name="folder" className="muted" />
          <span className="truncate">
            {workspace === null ? "未选择工作区" : projectNameFromPath(workspace)}
          </span>
        </div>
        <span className="spacer" />
        {state.ended ? null : (
          <>
            <Button variant="secondary" size="sm" onClick={() => void session.cancel()}>
              取消
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void session.stop()}>
              停止会话
            </Button>
          </>
        )}
        <span className={state.ended ? "status info" : waiting ? "status warn" : "status ok"}>
          {statusText}
        </span>
        <Button
          variant="plain"
          className="icon-btn"
          type="button"
          aria-label="会话环境"
          onClick={() => setDrawerOpen((value) => !value)}
        >
          <Icon name="sidebar" />
        </Button>
      </div>
      {error === null ? null : (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {session.modelsLoading ? (
        <p className="note">
          模型加载中…{" "}
          <Button variant="ghost" size="sm" onClick={session.cancelModels}>
            取消
          </Button>
        </p>
      ) : null}
      {session.modelsError === null ? null : (
        <p className="note">
          模型列表不可用：{session.modelsError}{" "}
          <Button variant="ghost" size="sm" onClick={() => void session.refreshModels(true)}>
            重试
          </Button>
        </p>
      )}
      <ChatThread
        state={state}
        accounts={accounts}
        onRespondPermission={(requestId, decision) => {
          void session.respondPermission(requestId, decision)
        }}
      />
      <div className="composer-wrap">
        <Composer {...composer} placeholder="继续追问" menuSide="top" onSubmit={submit} />
        <p className="composer-meta">经本机中继发出 · pigclaude 只记录用量元数据</p>
      </div>
      {drawerOpen ? <ChatDrawer state={state} accounts={accounts} workspace={workspace} /> : null}
      <BypassDialog
        open={pendingBypass}
        onOpenChange={setPendingBypass}
        onConfirm={() => {
          setPermissionMode("bypassPermissions")
          setPendingBypass(false)
          void session.setMode("bypassPermissions")
        }}
      />
    </section>
  )
}

function BypassDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>跳过所有确认？</DialogTitle>
          <DialogDescription>
            跳过确认后，Claude
            运行命令和修改文件都不再询问。只在临时排障时使用，并确认工作区可丢弃或已有备份。
          </DialogDescription>
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button variant="danger" onClick={onConfirm}>
            仍然启用
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
