// 负责展示 usage.summary 的今天/7 天汇总：请求数、输入输出、缓存、平均耗时和错误数。
// 没有记录时只显示空态，不伪造数字。

import { desktopText } from "../locale/text"
import { useState } from "react"
import { SettingPage, SettingRow, SettingSection } from "@pigclaude/ui-primitives"
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group"
import type { UsageBridge, UsageRange, UsageSummary } from "../../../main/session/session-types"
import { useUsageSummary } from "../hooks/use-usage-summary"

const ranges = [
  ["today", desktopText("settings.usage-screen.1")],
  ["7d", desktopText("settings.usage-screen.2")],
] as const

/** 用量页面 props；bridge 可注入给测试。 */
export type UsageScreenProps = { bridge?: UsageBridge | null }

/** 绘制只含元数据的用量汇总。 */
export function UsageScreen({ bridge }: UsageScreenProps) {
  const [range, setRange] = useState<UsageRange>("today")
  const { summary, loading, error } = useUsageSummary(range, bridge)

  return (
    <SettingPage
      title={desktopText("settings.usage-screen.3")}
      sub={desktopText("settings.usage-screen.5")}
      actions={
        <ToggleGroup
          type="single"
          aria-label={desktopText("settings.usage-screen.6")}
          value={range}
          onValueChange={(next) => {
            if (next === "today" || next === "7d") setRange(next)
          }}
        >
          {ranges.map(([id, label]) => (
            <ToggleGroupItem key={id} value={id}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      }
    >
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="note">{desktopText("settings.usage-screen.7")}</p> : null}
      {!loading && error === null && summary !== null && summary.requests === 0 ? (
        <p className="note">{desktopText("settings.usage-screen.8")}</p>
      ) : null}
      {!loading && error === null && summary !== null && summary.requests > 0 ? (
        <>
          <div className="stats">
            {summaryStats(summary, range).map(([label, value, detail]) => (
              <div className="stat" key={label}>
                <div className="v">{value}</div>
                <div className="k">{label}</div>
                <span className="muted">{detail}</span>
              </div>
            ))}
          </div>
          <SettingSection title={desktopText("settings.usage-screen.9")}>
            <SettingRow
              title={desktopText("settings.usage-screen.10")}
              description={desktopText("settings.usage-screen.11")}
            />
            <SettingRow
              title={desktopText("settings.usage-screen.12")}
              description={desktopText("settings.usage-screen.13")}
            />
          </SettingSection>
        </>
      ) : null}
    </SettingPage>
  )
}

function summaryStats(
  summary: UsageSummary,
  range: UsageRange,
): Array<[label: string, value: string, detail: string]> {
  const cache = summary.cacheReadTokens + summary.cacheCreationTokens
  return [
    [
      desktopText("settings.usage-screen.14"),
      String(summary.requests),
      range === "today"
        ? desktopText("settings.usage-screen.15")
        : desktopText("settings.usage-screen.16"),
    ],
    [
      desktopText("settings.usage-screen.17"),
      formatNumber(summary.inputTokens),
      desktopText("settings.usage-screen.18"),
    ],
    [
      desktopText("settings.usage-screen.19"),
      formatNumber(summary.outputTokens),
      desktopText("settings.usage-screen.20"),
    ],
    [
      desktopText("settings.usage-screen.21"),
      formatNumber(cache),
      desktopText("settings.usage-screen.22", {
        value1: String(formatNumber(summary.cacheReadTokens)),
      }),
    ],
    [
      desktopText("settings.usage-screen.23"),
      formatDuration(summary.averageDurationMs),
      desktopText("settings.usage-screen.24"),
    ],
    [
      desktopText("settings.usage-screen.25"),
      String(summary.errors),
      summary.errors === 0
        ? desktopText("settings.usage-screen.26")
        : desktopText("settings.usage-screen.27"),
    ],
  ]
}

function formatNumber(value: number): string {
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`
  if (value >= 1_000) return `${trim(value / 1_000)}K`
  return String(value)
}

function trim(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "")
}

function formatDuration(value: number): string {
  if (value < 1_000) return `${Math.round(value)}ms`
  return `${trim(value / 1_000)}s`
}
