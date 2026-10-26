// 负责逐项展示本机中继、Claude Code CLI、账号、代理和出口检测结果；
// 数据来自 session.status、session.models、claudeAccounts 和 proxies，不显示 token、代理地址或环境变量。

import { useEffect, useState } from "react"
import type { ClaudeAccountView, EgressView, ProxyView } from "@pigclaude/contracts/claude-account"
import { Button } from "../components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select"
import type { ClaudeModel, SessionStatusView } from "../../../main/session/session-types"

/** 环境检测页面 props；所有数据由 main-window 的控制器和账号 hook 提供。 */
export type EnvironmentScreenProps = {
  accounts: ClaudeAccountView[]
  proxies: ProxyView[]
  status: SessionStatusView | null
  models: ClaudeModel[]
  modelsLoading: boolean
  modelsError: string | null
  onLoadModels: () => void
  onCancelModels: () => void
  onRecheck: () => void
  onCheckEgress: (proxyId: string) => Promise<EgressView>
}

/** 绘制环境检测和网络路径。 */
export function EnvironmentScreen({
  accounts,
  proxies,
  status,
  models,
  modelsLoading,
  modelsError,
  onLoadModels,
  onCancelModels,
  onRecheck,
  onCheckEgress,
}: EnvironmentScreenProps) {
  const [proxyId, setProxyId] = useState<string | null>(null)
  const [egress, setEgress] = useState<EgressView | null>(null)
  const [egressLoading, setEgressLoading] = useState(false)
  const [egressError, setEgressError] = useState<string | null>(null)
  const proxy = proxies.find((item) => item.id === proxyId) ?? proxies[0] ?? null
  const availableAccounts = accounts.filter(
    (account) => account.enabled && !account.needsReauth && !isCoolingDown(account.exhaustedUntil),
  )
  const cli = cliState(models, modelsLoading, modelsError)
  const daemon = daemonState(status, models, modelsLoading, modelsError)

  useEffect(() => {
    if (models.length > 0 || modelsLoading || modelsError !== null) return
    onLoadModels()
  }, [models.length, modelsError, modelsLoading, onLoadModels])

  async function checkEgress(): Promise<void> {
    if (proxy === null) return
    setEgressLoading(true)
    setEgressError(null)
    try {
      setEgress(await onCheckEgress(proxy.id))
    } catch {
      setEgressError("出口检测失败，请检查代理")
    } finally {
      setEgressLoading(false)
    }
  }

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>环境检测</h1>
          <p className="sub">会话进程环境逐项核对与网络路径</p>
        </div>
        <div className="actions">
          <Button variant="primary" onClick={onRecheck} disabled={modelsLoading}>
            {modelsLoading ? "检测中…" : "重新检测"}
          </Button>
          {modelsLoading ? (
            <Button variant="ghost" onClick={onCancelModels}>
              取消检测
            </Button>
          ) : null}
        </div>
      </header>
      <section className="section">
        <div className="section-head">
          <h2>会话进程</h2>
          <span className="end">{modelsLoading ? "检测中" : cli.label}</span>
        </div>
        <div className="group">
          <CheckRow label="本机中继" value={daemon.value} status={daemon.status} />
          <CheckRow label="Claude Code" value={cli.value} status={cli.status} />
          <CheckRow
            label="活动会话"
            value={
              status?.active === true
                ? `会话运行中 · ${status.model ?? "默认模型"}`
                : "没有活动会话"
            }
            status={status?.active === true ? "ok" : "idle"}
          />
          <CheckRow
            label="Claude 账号"
            value={
              accounts.length === 0
                ? "没有可用的 Claude 账号"
                : `${accounts.length} 个账号 · ${availableAccounts.length} 个可用`
            }
            status={availableAccounts.length > 0 ? "ok" : "bad"}
          />
        </div>
        {modelsError !== null ? (
          <p className="error-text" role="alert">
            {modelsError}
          </p>
        ) : null}
        <p className="note">模型探针会启动一次 Claude Code 查询，可能较慢；失败不影响已有会话。</p>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>网络路径</h2>
          {proxies.length > 0 ? (
            <Select value={proxy?.id ?? ""} onValueChange={setProxyId}>
              <SelectTrigger aria-label="代理" className="select-bare">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {proxies.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
        <div className="group">
          <CheckRow
            label="账号绑定代理"
            value={
              proxy === null
                ? "没有代理"
                : proxy.lastTest?.ok === true
                  ? `${proxy.name} · ${proxy.lastTest.ip ?? "出口未知"}`
                  : proxy.lastTest === null
                    ? `${proxy.name} · 待检测`
                    : `${proxy.name} · 未通过测试`
            }
            status={proxy?.lastTest?.ok === true ? "ok" : proxy === null ? "bad" : "warn"}
          />
          <CheckRow
            label="出口检测"
            value={egressValue(egress, egressLoading, egressError)}
            status={egress?.ok === true ? "ok" : egress === null ? "idle" : "bad"}
          />
        </div>
        <div className="row">
          <Button
            size="sm"
            variant="secondary"
            disabled={proxy === null || egressLoading}
            onClick={() => void checkEgress()}
          >
            {egressLoading ? "检测中…" : "检测出口"}
          </Button>
        </div>
        <p className="note">代理不通时，请求以 503 结束，不会从本机网络直接发出。</p>
      </section>
    </div>
  )
}

type CheckStatus = "ok" | "warn" | "bad" | "idle"

function CheckRow({ label, value, status }: { label: string; value: string; status: CheckStatus }) {
  return (
    <div className="item">
      <div className="main">
        <div className="ttl">{label}</div>
        <div className="desc">{value}</div>
      </div>
      <span className={statusClass(status)}>{statusText(status)}</span>
    </div>
  )
}

function statusClass(status: CheckStatus): string {
  if (status === "ok") return "status ok"
  if (status === "warn") return "status warn"
  if (status === "bad") return "status bad"
  return "status info"
}

function statusText(status: CheckStatus): string {
  if (status === "ok") return "正常"
  if (status === "warn") return "待处理"
  if (status === "bad") return "不可用"
  return "未检测"
}

function cliState(
  models: ClaudeModel[],
  loading: boolean,
  error: string | null,
): { value: string; status: CheckStatus; label: string } {
  if (loading)
    return { value: "正在通过会话模型探针检查 Claude Code", status: "idle", label: "检测中" }
  if (error !== null) {
    return { value: `没有可用的模型 · ${error}`, status: "bad", label: "不可用" }
  }
  if (models.length === 0) return { value: "没有可用的模型", status: "bad", label: "不可用" }
  return { value: `可用 · ${models.length} 个模型`, status: "ok", label: "正常" }
}

function daemonState(
  status: SessionStatusView | null,
  models: ClaudeModel[],
  loading: boolean,
  error: string | null,
): { value: string; status: CheckStatus } {
  if (loading) return { value: "检测中", status: "idle" }
  if (status?.active === true) return { value: "会话运行中", status: "ok" }
  if (models.length > 0) return { value: "可用", status: "ok" }
  return { value: error ?? "未检测到可用中继", status: "bad" }
}

function egressValue(egress: EgressView | null, loading: boolean, error: string | null): string {
  if (loading) return "检测中…"
  if (error !== null) return error
  if (egress === null) return "尚未检测"
  return egress.ok ? `出口 IP ${egress.ip}` : egress.message
}

function isCoolingDown(value: string | null | undefined): boolean {
  if (value === null || value === undefined) return false
  const until = Date.parse(value)
  return Number.isFinite(until) && until > Date.now()
}
