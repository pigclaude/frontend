// 负责逐项展示本机中继、Claude Code CLI、账号、代理和出口检测结果；
// 数据来自 session.status、session.models、claudeAccounts 和 proxies，不显示 token、代理地址或环境变量。

import { desktopText } from "../locale/text"
import { SettingPage, SettingRow } from "@pigclaude/ui-primitives"
import { useEffect, useState } from "react"
import {
  isAccountSelectable,
  type ClaudeAccountView,
  type EgressView,
  type ProxyView,
} from "@pigclaude/contracts/claude-account"
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
  /** Claude Code 没有列出模型的原因；这时 models 是内置目录，检查结果仍按失败显示。 */
  modelsCliError: string | null
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
  modelsCliError,
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
  const proxyUrls = new Map(proxies.map((item) => [item.id, item.url]))
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
  const probeError = modelsError ?? modelsCliError
  const cli = cliState(models, modelsLoading, probeError)
  const daemon = daemonState(status, models, modelsLoading, probeError)

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
      setEgressError(desktopText("settings.environment-screen.1"))
    } finally {
      setEgressLoading(false)
    }
  }

  return (
    <SettingPage
      title={desktopText("settings.environment-screen.2")}
      sub={desktopText("settings.environment-screen.3")}
      actions={
        <>
          <Button variant="primary" onClick={onRecheck} disabled={modelsLoading}>
            {modelsLoading
              ? desktopText("settings.environment-screen.4")
              : desktopText("settings.environment-screen.5")}
          </Button>
          {modelsLoading ? (
            <Button variant="ghost" onClick={onCancelModels}>
              {desktopText("settings.environment-screen.6")}
            </Button>
          ) : null}
        </>
      }
    >
      <section className="section">
        <div className="section-head">
          <h2>{desktopText("settings.environment-screen.7")}</h2>
          <span className="end">
            {modelsLoading ? desktopText("settings.environment-screen.8") : cli.label}
          </span>
        </div>
        <div className="group">
          <CheckRow
            label={desktopText("settings.environment-screen.9")}
            value={daemon.value}
            status={daemon.status}
          />
          <CheckRow label="Claude Code" value={cli.value} status={cli.status} />
          <CheckRow
            label={desktopText("settings.environment-screen.10")}
            value={
              status?.active === true
                ? desktopText("settings.environment-screen.11", {
                    value1: String(status.model ?? "—"),
                  })
                : desktopText("settings.environment-screen.12")
            }
            status={status?.active === true ? "ok" : "idle"}
          />
          <CheckRow
            label={desktopText("settings.environment-screen.13")}
            value={
              accounts.length === 0
                ? desktopText("settings.environment-screen.14")
                : desktopText("settings.environment-screen.15", {
                    value1: String(accounts.length),
                    value2: String(availableAccounts.length),
                  })
            }
            status={availableAccounts.length > 0 ? "ok" : "bad"}
          />
        </div>
        {probeError !== null ? (
          <p className="error-text" role="alert">
            {probeError}
          </p>
        ) : null}
        <p className="note">{desktopText("settings.environment-screen.16")}</p>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>{desktopText("settings.environment-screen.17")}</h2>
          {proxies.length > 0 ? (
            <Select value={proxy?.id ?? ""} onValueChange={setProxyId}>
              <SelectTrigger
                aria-label={desktopText("settings.environment-screen.18")}
                className="select-bare"
              >
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
            label={desktopText("settings.environment-screen.19")}
            value={
              proxy === null
                ? desktopText("settings.environment-screen.20")
                : proxy.lastTest?.ok === true
                  ? `${proxy.name} · ${proxy.lastTest.ip ?? desktopText("settings.environment-screen.21")}`
                  : proxy.lastTest === null
                    ? desktopText("settings.environment-screen.22", { value1: String(proxy.name) })
                    : desktopText("settings.environment-screen.23", { value1: String(proxy.name) })
            }
            status={proxy?.lastTest?.ok === true ? "ok" : proxy === null ? "ok" : "warn"}
          />
          <CheckRow
            label={desktopText("settings.environment-screen.24")}
            value={
              proxy === null
                ? desktopText("settings.environment-screen.25")
                : egressValue(egress, egressLoading, egressError)
            }
            status={egress?.ok === true ? "ok" : proxy === null || egress === null ? "idle" : "bad"}
          />
        </div>
        <div className="row">
          <Button
            size="sm"
            variant="secondary"
            disabled={proxy === null || egressLoading}
            onClick={() => void checkEgress()}
          >
            {egressLoading
              ? desktopText("settings.environment-screen.26")
              : desktopText("settings.environment-screen.27")}
          </Button>
        </div>
        <p className="note">{desktopText("settings.environment-screen.28")}</p>
      </section>
    </SettingPage>
  )
}

type CheckStatus = "ok" | "warn" | "bad" | "idle"

function CheckRow({ label, value, status }: { label: string; value: string; status: CheckStatus }) {
  return (
    <SettingRow
      title={label}
      description={value}
      value={<span className={statusClass(status)}>{statusText(status)}</span>}
    />
  )
}

function statusClass(status: CheckStatus): string {
  if (status === "ok") return "status ok"
  if (status === "warn") return "status warn"
  if (status === "bad") return "status bad"
  return "status info"
}

function statusText(status: CheckStatus): string {
  if (status === "ok") return desktopText("settings.environment-screen.29")
  if (status === "warn") return desktopText("settings.environment-screen.30")
  if (status === "bad") return desktopText("settings.environment-screen.31")
  return desktopText("settings.environment-screen.32")
}

function cliState(
  models: ClaudeModel[],
  loading: boolean,
  error: string | null,
): { value: string; status: CheckStatus; label: string } {
  if (loading)
    return {
      value: desktopText("settings.environment-screen.33"),
      status: "idle",
      label: desktopText("settings.environment-screen.34"),
    }
  if (error !== null) {
    return {
      value: desktopText("settings.environment-screen.35", { value1: String(error) }),
      status: "bad",
      label: desktopText("settings.environment-screen.36"),
    }
  }
  if (models.length === 0)
    return {
      value: desktopText("settings.environment-screen.37"),
      status: "bad",
      label: desktopText("settings.environment-screen.38"),
    }
  return {
    value: desktopText("settings.environment-screen.39", { value1: String(models.length) }),
    status: "ok",
    label: desktopText("settings.environment-screen.40"),
  }
}

function daemonState(
  status: SessionStatusView | null,
  models: ClaudeModel[],
  loading: boolean,
  error: string | null,
): { value: string; status: CheckStatus } {
  if (loading) return { value: desktopText("settings.environment-screen.41"), status: "idle" }
  if (status?.active === true)
    return { value: desktopText("settings.environment-screen.42"), status: "ok" }
  if (error !== null) return { value: error, status: "bad" }
  if (models.length > 0)
    return { value: desktopText("settings.environment-screen.43"), status: "ok" }
  return { value: desktopText("settings.environment-screen.44"), status: "bad" }
}

function egressValue(egress: EgressView | null, loading: boolean, error: string | null): string {
  if (loading) return desktopText("settings.environment-screen.45")
  if (error !== null) return error
  if (egress === null) return desktopText("settings.environment-screen.46")
  return egress.ok
    ? desktopText("settings.environment-screen.47", { value1: String(egress.ip) })
    : egress.message
}
