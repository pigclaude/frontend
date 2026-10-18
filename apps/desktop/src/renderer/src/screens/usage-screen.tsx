// 负责展示只包含元数据的用量统计、图表和请求记录。
import { useMemo, useState } from "react"
import { Button } from "../components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "../components/ui/toggle-group"
import { filterUsageRows, type UsageFilter } from "../models/operations-model"
import { operationsUsageFixture } from "../fixtures/operations-fixtures"

const ranges = [
  ["today", "今天"],
  ["7d", "7 天"],
  ["30d", "30 天"],
] as const

const filters = [
  ["all", "全部"],
  ["switch", "换号"],
  ["error", "错误"],
] as const satisfies readonly (readonly [UsageFilter, string])[]

/** 用量页面 props。 */
export type UsageScreenProps = { usageFixture?: typeof operationsUsageFixture }

/** 绘制用量统计、Token 图表、模型排行和请求日志。 */
export function UsageScreen({ usageFixture = operationsUsageFixture }: UsageScreenProps) {
  const [range, setRange] = useState("7d")
  const [split, setSplit] = useState("account")
  const [filter, setFilter] = useState<UsageFilter>("all")
  const [exported, setExported] = useState(false)
  const rows = useMemo(
    () => filterUsageRows([...usageFixture.requests], filter),
    [filter, usageFixture.requests],
  )
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
          onValueChange={(next) => next && setRange(next)}
        >
          {ranges.map(([id, label]) => (
            <ToggleGroupItem key={id} value={id}>
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </header>
      <div className="stats">
        {usageFixture.stats.map(([label, value, detail]) => (
          <div className="stat" key={label}>
            <div className="v">{value}</div>
            <div className="k">{label}</div>
            <span className="muted">{detail}</span>
          </div>
        ))}
      </div>
      <section className="section">
        <div className="section-head">
          <h2>每日 Token</h2>
          <ToggleGroup
            type="single"
            aria-label="图表分组"
            value={split}
            onValueChange={(next) => next && setSplit(next)}
          >
            <ToggleGroupItem value="account">按账号</ToggleGroupItem>
            <ToggleGroupItem value="model">按模型</ToggleGroupItem>
          </ToggleGroup>
        </div>
        <div className="group chart-box">
          <svg
            className="chart-svg"
            viewBox="0 0 640 180"
            role="img"
            aria-label={`最近${range}用量图表`}
          >
            <path
              d="M20 150 C 100 145, 135 130, 180 136 S 250 110, 290 120 S 360 70, 420 96 S 520 54, 620 40"
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth="3"
            />
            <path
              d="M20 160 C 120 155, 180 152, 240 150 S 380 140, 450 146 S 560 120, 620 128"
              fill="none"
              stroke="var(--chart-2)"
              strokeWidth="2"
            />
            <line x1="20" y1="160" x2="620" y2="160" stroke="var(--divider)" />
          </svg>
          <div className="legend">
            <span>
              <i style={{ background: "var(--chart-1)" }} />
              {split === "account" ? "主力 Max" : "Opus 5.5"}
            </span>
            <span>
              <i style={{ background: "var(--chart-2)" }} />
              {split === "account" ? "备用 Pro" : "Sonnet 5.5"}
            </span>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>按模型</h2>
        </div>
        <div className="group">
          {usageFixture.models.map((model) => (
            <div className="item" key={model.name}>
              <div className="main">
                <div className="ttl">{model.name}</div>
                <div className="meter">
                  <span className="bar">
                    <i style={{ width: `${model.ratio}%` }} />
                  </span>
                  <span className="num">{model.ratio}%</span>
                </div>
              </div>
              <span className="val">{model.tokens}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>请求记录</h2>
          <ToggleGroup
            type="single"
            aria-label="请求筛选"
            value={filter}
            onValueChange={(next) => {
              const picked = filters.find(([id]) => id === next)
              if (picked) setFilter(picked[0])
            }}
          >
            {filters.map(([id, label]) => (
              <ToggleGroupItem key={id} value={id}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="group">
          <table className="dtable">
            <thead>
              <tr>
                <th>时间</th>
                <th>账号</th>
                <th>模型</th>
                <th>状态</th>
                <th className="r">输入 / 输出</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.time ?? "—"}</td>
                  <td>{row.account ?? "—"}</td>
                  <td>{row.model}</td>
                  <td>
                    <span
                      className={
                        row.status >= 500
                          ? "status bad"
                          : row.status === 429
                            ? "status warn"
                            : "status ok"
                      }
                    >
                      {row.status}
                    </span>
                  </td>
                  <td className="r num">
                    {row.input ?? 0} / {row.output ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="note">
          <Button variant="ghost" size="sm" onClick={() => setExported(true)}>
            导出 CSV
          </Button>
          {exported ? "已导出（只含元数据）" : ""}
        </p>
      </section>
    </div>
  )
}
