// 负责逐项展示会话环境和网络路径检测结果。
import { useState } from "react"
import { Button } from "../components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select"
import { environmentFixtures } from "../fixtures/renderer-fixtures"

/** 环境检测页面 props。 */
export type EnvironmentScreenProps = { fixture?: typeof environmentFixtures }

/** 绘制环境检测、账号选择和重检状态。 */
export function EnvironmentScreen({ fixture = environmentFixtures }: EnvironmentScreenProps) {
  const [account, setAccount] = useState<string>(fixture.accountId)
  const [running, setRunning] = useState(false)
  function rerun() {
    setRunning(true)
    window.setTimeout(() => setRunning(false), 650)
  }
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>环境检测</h1>
          <p className="sub">会话进程环境逐项核对与网络路径</p>
        </div>
        <div className="actions">
          <Select value={account} onValueChange={setAccount}>
            <SelectTrigger aria-label="账号" className="select-bare">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="primary">主力 Max</SelectItem>
              <SelectItem value="work">工作 Max</SelectItem>
              <SelectItem value="backup">备用 Pro</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="primary" onClick={rerun} disabled={running}>
            {running ? "检测中…" : "重新检测"}
          </Button>
        </div>
      </header>
      <section className="section">
        <div className="section-head">
          <h2>会话进程</h2>
          <span className="end">{running ? "检测中" : "全部一致"}</span>
        </div>
        <div className="group">
          {fixture.checks.map((check) => (
            <div className="item" key={check.label}>
              <div className="main">
                <div className="ttl">{check.label}</div>
                <div className="desc mono">{check.value}</div>
              </div>
              <span className="status ok">一致</span>
            </div>
          ))}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>网络路径</h2>
        </div>
        <div className="group">
          {fixture.route.map((step) => (
            <div className="item" key={step.label}>
              <div className="main">
                <div className="ttl">{step.label}</div>
                <div className="desc">{step.value}</div>
              </div>
              <span className="status ok">通过</span>
            </div>
          ))}
        </div>
        <p className="note">代理不通时，请求以 503 结束，不会从本机网络直接发出。</p>
      </section>
    </div>
  )
}
