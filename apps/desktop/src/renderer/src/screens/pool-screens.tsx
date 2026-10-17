// 负责号池相关页面：Claude 账号、代理、用量和环境检测。
import { Button } from "../components/ui/button"
import type { Screen } from "./screen"

const accounts = [
  ["工作 Max", "工", "已用尽 · 1:20 后恢复", "100%", "bad"],
  ["主力 Max", "主", "服务中 · 2:14 后重置", "62%", "ok"],
  ["备用 Pro", "备", "待命 · 4:51 后重置", "8%", ""],
  ["旧号 Pro", "旧", "需要重新授权 · 不参与自动切换", "", "info"],
] as const

/** 列出 Claude 账号，并给出进入重新授权的入口。 */
export function AccountsScreen({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>Claude 账号</h1>
          <p className="sub">需要处理的事、自动切换顺序</p>
        </div>
        <Button variant="primary" onClick={() => onNavigate("authorize")}>
          添加账号
        </Button>
      </header>
      <section className="section">
        <div className="section-head">
          <h2>需要处理</h2>
        </div>
        <div className="group">
          <button className="item" type="button" onClick={() => onNavigate("authorize")}>
            <span className="avatar">旧</span>
            <div className="main">
              <div className="ttl">旧号 Pro</div>
              <div className="desc">需要重新授权 · 不参与自动切换</div>
            </div>
            <span className="status info">需重新授权</span>
          </button>
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>自动切换顺序</h2>
        </div>
        <div className="group">
          {accounts.slice(0, 3).map(([name, mark, line, ratio]) => (
            <div className="item" key={name}>
              <span className="avatar">{mark}</span>
              <div className="main">
                <div className="ttl">{name}</div>
                <div className="desc">{line}</div>
                {ratio ? (
                  <div className="quota-line">
                    <span style={{ width: ratio }} />
                  </div>
                ) : null}
              </div>
              <span className="val">{ratio}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

/** 列出本机代理和绑定关系。 */
export function ProxiesScreen() {
  const rows = [
    ["LA-01", "203.0.113.42 · 洛杉矶 · 住宅", "186 ms", "主力 Max"],
    ["SJC-02", "198.51.100.17 · 圣何塞", "172 ms", "工作 Max"],
    ["SEA-03", "203.0.113.88 · 西雅图 · 出口不固定", "201 ms", "备用 Pro"],
  ]
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>代理</h1>
          <p className="sub">每个账号绑定一个代理，登录和对话都只走它</p>
        </div>
      </header>
      <div className="group">
        {rows.map(([name, desc, delay, account]) => (
          <div className="item" key={name}>
            <div className="main">
              <div className="ttl">{name}</div>
              <div className="desc">{desc}</div>
            </div>
            <span className="val">
              {delay}
              <div className="muted">{account}</div>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** 只展示用量元数据，不出现提示词或回复。 */
export function UsageScreen() {
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
      </header>
      <section className="section">
        <div className="section-head">
          <h2>请求记录</h2>
        </div>
        <div className="group">
          <div className="item">
            <div className="main">
              <div className="ttl">14:32 · 主力 Max · Opus</div>
              <div className="desc">200 · 18s</div>
            </div>
            <span className="val">1.2K / 860</span>
          </div>
          <div className="item">
            <div className="main">
              <div className="ttl">14:31 · 工作 Max · Opus</div>
              <div className="desc">额度用尽后换号</div>
            </div>
            <span className="val">1.2K / 0</span>
          </div>
        </div>
      </section>
    </div>
  )
}

/** 逐项核对会话环境和出口。 */
export function EnvironmentScreen() {
  return (
    <div className="page narrow">
      <header className="page-head">
        <div>
          <h1>环境检测</h1>
          <p className="sub">会话进程环境逐项核对与网络路径</p>
        </div>
      </header>
      <div className="group">
        <div className="item">
          <div className="main">
            <div className="ttl">请求地址</div>
            <div className="desc mono">127.0.0.1:47821</div>
          </div>
          <span className="status ok">一致</span>
        </div>
        <div className="item">
          <div className="main">
            <div className="ttl">时区</div>
            <div className="desc mono">America/Los_Angeles</div>
          </div>
          <span className="status ok">一致</span>
        </div>
        <div className="item">
          <div className="main">
            <div className="ttl">~/.claude/settings.json</div>
            <div className="desc">应用内会话不读取</div>
          </div>
          <span className="status ok">已忽略</span>
        </div>
      </div>
    </div>
  )
}
