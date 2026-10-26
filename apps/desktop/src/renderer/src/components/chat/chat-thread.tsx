// 负责绘制会话消息流：用户消息、流式文本、可折叠思考块、工具调用、权限卡片、换号提示和结果。

import { useState } from "react"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import { Icon } from "../icon"
import { Button } from "../ui/button"
import type {
  SessionAccountSwitch,
  SessionPermissionCard,
  SessionResult,
  SessionToolCall,
  SessionTurn,
  SessionUiState,
} from "../../models/session-model"

/** 消息流 props。 */
export type ChatThreadProps = {
  state: SessionUiState
  accounts: ClaudeAccountView[]
  onRespondPermission: (requestId: string, decision: "allow" | "deny") => void
}

/** 按轮次绘制消息流。 */
export function ChatThread({ state, accounts, onRespondPermission }: ChatThreadProps) {
  return (
    <div className="thread">
      <div className="msgs">
        {state.turns.length === 0 ? <p className="note">等待 Claude 回复…</p> : null}
        {state.turns.map((turn) => (
          <Turn
            key={turn.id}
            turn={turn}
            accounts={accounts}
            onRespondPermission={onRespondPermission}
          />
        ))}
      </div>
    </div>
  )
}

function Turn({
  turn,
  accounts,
  onRespondPermission,
}: {
  turn: SessionTurn
  accounts: ClaudeAccountView[]
  onRespondPermission: (requestId: string, decision: "allow" | "deny") => void
}) {
  return (
    <>
      {turn.userText === null ? null : <div className="msg-user">{turn.userText}</div>}
      <div className="msg-ai">
        {turn.blocks.map((block, index) => {
          if (block.type === "text") {
            return (
              <p key={`text-${index}`} style={{ whiteSpace: "pre-wrap" }}>
                {block.text}
              </p>
            )
          }
          if (block.type === "thinking") {
            return <Thinking key={`thinking-${index}`} text={block.text} />
          }
          return null
        })}
        <ToolCalls tools={turn.tools} />
        {turn.switches.map((event, index) => (
          <div className="event-line" key={`switch-${index}`}>
            <Icon name="swap" small />
            <span>{switchText(event.from, event.to, event.reason, accounts)}</span>
          </div>
        ))}
        {turn.permissions.map((card) => (
          <PermissionCard key={card.requestId} card={card} onRespond={onRespondPermission} />
        ))}
        {turn.errors.map((error, index) => (
          <div className="event-line" key={`error-${error.code}-${index}`}>
            <Icon name="alert" small className={error.warning ? "t-warn" : "t-bad"} />
            <span>{error.message}</span>
          </div>
        ))}
        {turn.result === null ? null : <ResultLine result={turn.result} />}
        {turn.status === "cancelled" ? <div className="perm-done">已取消</div> : null}
      </div>
    </>
  )
}

function Thinking({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <Button
        variant="plain"
        className="steps-line"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="right" small className="chev" />
        思考过程
      </Button>
      {open ? (
        <div className="steps-list">
          <div>
            <span className="mono" style={{ whiteSpace: "pre-wrap" }}>
              {text}
            </span>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ToolCalls({ tools }: { tools: SessionToolCall[] }) {
  const [open, setOpen] = useState(false)
  if (tools.length === 0) return null
  return (
    <div>
      <Button
        variant="plain"
        className="steps-line"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="right" small className="chev" />
        工具调用 {tools.length} 次
      </Button>
      {open ? (
        <div className="steps-list">
          {tools.map((tool) => (
            <div key={tool.id}>
              <Icon name={tool.status === "running" ? "spinner" : "terminal"} small />
              <b>{tool.name}</b>
              <span className="mono">{tool.output ?? toolStatusText(tool.status)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function PermissionCard({
  card,
  onRespond,
}: {
  card: SessionPermissionCard
  onRespond: (requestId: string, decision: "allow" | "deny") => void
}) {
  if (card.status !== "pending") {
    return (
      <div className="perm-done">
        <Icon name="check" small />
        {permissionStatusText(card.status)}
      </div>
    )
  }
  return (
    <div className="perm">
      <div className="q">
        <Icon name="hand" />
        允许运行 {card.toolName} 吗？
      </div>
      {card.blockedPath === null ? null : <p className="desc mono">{card.blockedPath}</p>}
      <pre>{formatInput(card.input)}</pre>
      <div className="acts">
        <Button variant="primary" onClick={() => onRespond(card.requestId, "allow")}>
          允许一次
        </Button>
        <Button variant="ghost" onClick={() => onRespond(card.requestId, "deny")}>
          拒绝
        </Button>
      </div>
    </div>
  )
}

function ResultLine({ result }: { result: SessionResult }) {
  return (
    <div className="event-line">
      <Icon name="bars" small className={result.isError ? "t-bad" : "t-ok"} />
      <span>
        耗时 {formatDuration(result.durationMs)} · 输入 {result.inputTokens} / 输出{" "}
        {result.outputTokens} · {result.numTurns} 轮
      </span>
    </div>
  )
}

function switchText(
  from: string | null,
  to: string,
  reason: SessionAccountSwitch["reason"],
  accounts: ClaudeAccountView[],
): string {
  const fromName = from === null ? "上一个账号" : accountName(accounts, from)
  const toName = accountName(accounts, to)
  if (from === null) return `已切换到 ${toName}`
  if (reason === "quota") return `${fromName} 额度用尽，已切换到 ${toName}`
  return `已从 ${fromName} 切换到 ${toName}`
}

function accountName(accounts: ClaudeAccountView[], id: string): string {
  return accounts.find((account) => account.id === id)?.displayName ?? id
}

function toolStatusText(status: SessionToolCall["status"]): string {
  if (status === "running") return "运行中"
  if (status === "error") return "失败"
  return "完成"
}

function permissionStatusText(status: SessionPermissionCard["status"]): string {
  if (status === "allowed") return "已允许一次"
  if (status === "timeout") return "权限询问超时，已拒绝"
  if (status === "denied") return "已拒绝"
  return "等待回答"
}

function formatInput(input: Record<string, unknown>): string {
  try {
    const text = JSON.stringify(input, null, 2)
    return text.length > 1_200 ? `${text.slice(0, 1_200)}…` : text
  } catch {
    return "无法显示工具输入"
  }
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)}ms`
  const seconds = value / 1_000
  return `${seconds.toFixed(1).replace(/\.0$/, "")}s`
}
