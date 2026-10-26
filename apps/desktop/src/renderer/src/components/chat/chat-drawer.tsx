// 负责会话环境抽屉：工作区、模型、权限模式、账号、换号记录和本会话用量，不显示 token 或环境变量。

import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import type { SessionUiState } from "../../models/session-model"
import { projectNameFromPath } from "../../models/project-model"

/** 会话环境抽屉 props。 */
export type ChatDrawerProps = {
  state: SessionUiState
  accounts: ClaudeAccountView[]
  workspace: string | null
}

/** 绘制脱敏的会话环境信息。 */
export function ChatDrawer({ state, accounts, workspace }: ChatDrawerProps) {
  const switches = state.turns.flatMap((turn) => turn.switches)
  const results = state.turns.flatMap((turn) => (turn.result === null ? [] : [turn.result]))
  const inputTokens = results.reduce((sum, result) => sum + result.inputTokens, 0)
  const outputTokens = results.reduce((sum, result) => sum + result.outputTokens, 0)
  const pending = state.turns.reduce(
    (sum, turn) => sum + turn.permissions.filter((card) => card.status === "pending").length,
    0,
  )
  return (
    <aside className="drawer" aria-label="会话环境">
      <div className="section">
        <div className="section-head">
          <h2>会话环境</h2>
          <span className="end">{state.ended ? "已结束" : "运行中"}</span>
        </div>
        <div className="group">
          <Row
            label="工作区"
            value={workspace === null ? "未选择" : projectNameFromPath(workspace)}
          />
          <Row label="模型" value={state.model ?? "默认模型"} />
          <Row label="权限" value={modeText(state.permissionMode)} />
          <Row label="账号" value={accountName(accounts, state.accountId)} />
          <Row label="待回答权限" value={String(pending)} />
          <Row label="会话" value={state.sessionId === null ? "未开始" : "已建立"} />
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h2>服务账号</h2>
          <span className="end">换号 {switches.length} 次</span>
        </div>
        <div className="group">
          {switches.length === 0 ? (
            <Row label="没有换号" value="" />
          ) : (
            switches.map((event, index) => (
              <Row
                key={`${event.to}-${index}`}
                label={accountName(accounts, event.to)}
                value={event.reason === "quota" ? "额度用尽" : "切换"}
              />
            ))
          )}
        </div>
      </div>
      <div className="section">
        <div className="section-head">
          <h2>本会话用量</h2>
        </div>
        <div className="group">
          <Row label="请求" value={String(results.length)} />
          <Row label="输入 Token" value={String(inputTokens)} />
          <Row label="输出 Token" value={String(outputTokens)} />
        </div>
      </div>
    </aside>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="item">
      <div className="main">
        <div className="ttl">{label}</div>
      </div>
      <span className="val">{value}</span>
    </div>
  )
}

function accountName(accounts: ClaudeAccountView[], id: string | null): string {
  if (id === null) return "自动选择"
  return accounts.find((account) => account.id === id)?.displayName ?? id
}

function modeText(mode: SessionUiState["permissionMode"]): string {
  if (mode === "acceptEdits") return "自动改文件"
  if (mode === "plan") return "只做计划"
  if (mode === "bypassPermissions") return "跳过确认"
  return "每次询问"
}
