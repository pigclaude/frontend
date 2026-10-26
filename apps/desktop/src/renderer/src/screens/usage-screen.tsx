// 负责展示 usage.summary 的今天/7 天汇总：请求数、输入输出、缓存、平均耗时和错误数。
// 没有记录时只显示空态，不伪造数字。

import { useState } from "react"
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group"
import type { UsageBridge, UsageRange, UsageSummary } from "../../../main/session/session-types"
import { useUsageSummary } from "../hooks/use-usage-summary"

const ranges = [
  ["today", "今天"],
  ["7d", "7 天"],
] as const

/** 用量页面 props；bridge 可注入给测试。 */
export type UsageScreenProps = { bridge?: UsageBridge | null }

/** 绘制只含元数据的用量汇总。 */
export function UsageScreen({ bridge }: UsageScreenProps) {
  const [range, setRange] = useState<UsageRange>("today")
  const { summary, loading, error } = useUsageSummary(range, bridge)

  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <div className="h1-row">
            <h1>用量</h1>
            <span className="tag">只记元数据</span>
          </div>
          <p className="sub">时间、账号、模型、状态码、耗时和 Token 数；不含提示词和回复</p>
        </div>
        <ToggleGroup
          type="single"
          aria-label="时间范围"
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
      </header>
      {error ? (
        <p className="error-text" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="note">读取中…</p> : null}
      {!loading && error === null && summary !== null && summary.requests === 0 ? (
        <p className="note">
          还没有用量记录。开始一次会话后，这里只显示请求数、Token 和耗时的汇总。
        </p>
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
          <section className="section">
            <div className="section-head">
              <h2>说明</h2>
            </div>
            <div className="group">
              <div className="item">
                <div className="main">
                  <div className="ttl">写入位置</div>
                  <div className="desc">本机 usage.jsonl，只追加元数据</div>
                </div>
              </div>
              <div className="item">
                <div className="main">
                  <div className="ttl">保留</div>
                  <div className="desc">超过 30 天的记录会自动清理</div>
                </div>
              </div>
            </div>
          </section>
        </>
      ) : null}
    </div>
  )
}

function summaryStats(
  summary: UsageSummary,
  range: UsageRange,
): Array<[label: string, value: string, detail: string]> {
  const cache = summary.cacheReadTokens + summary.cacheCreationTokens
  return [
    ["请求", String(summary.requests), range === "today" ? "今天" : "最近 7 天"],
    ["输入 Token", formatNumber(summary.inputTokens), "不含缓存"],
    ["输出 Token", formatNumber(summary.outputTokens), "会话产出"],
    ["缓存 Token", formatNumber(cache), `读取 ${formatNumber(summary.cacheReadTokens)}`],
    ["平均耗时", formatDuration(summary.averageDurationMs), "每个请求"],
    ["错误", String(summary.errors), summary.errors === 0 ? "没有错误" : "检查账号或代理"],
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
