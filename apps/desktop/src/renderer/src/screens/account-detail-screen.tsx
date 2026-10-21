// 负责展示单个 Claude 账号的额度、代理、指纹和凭据状态。
import { Button } from "../components/ui/button"
import type { PoolAccount } from "../fixtures/pool-fixtures"

/** 账号详情页面 props。 */
export type AccountDetailScreenProps = {
  account: PoolAccount
  onBack: () => void
  onReauthorize: () => void
  onDelete: () => void
  onChangeProxy: () => void
  onEditFingerprint: () => void
}

/** 绘制账号详情和操作入口。 */
export function AccountDetailScreen({
  account,
  onBack,
  onReauthorize,
  onDelete,
  onChangeProxy,
  onEditFingerprint,
}: AccountDetailScreenProps) {
  return (
    <div className="page narrow">
      <Button variant="plain" className="back" type="button" onClick={onBack}>
        ‹ 账号
      </Button>
      <header className="page-head who-head">
        <div className="row">
          <span className="avatar lg">{account.mark}</span>
          <div>
            <h1>{account.name}</h1>
            <p className="sub">
              Claude 官方订阅账号 · {account.status}
              {account.email ? ` · ${account.email}` : ""}
            </p>
          </div>
        </div>
        <div className="actions">
          <Button variant="primary" onClick={onReauthorize}>
            重新授权
          </Button>
          <Button variant="danger" onClick={onDelete}>
            删除
          </Button>
        </div>
      </header>
      <section className="section">
        <div className="section-head">
          <h2>额度</h2>
        </div>
        <div className="group">
          <div className="item">
            <div className="main">
              <div className="ttl">5 小时窗口</div>
              <div className="desc">用到 100% 后换到下一个账号</div>
            </div>
            <span className="meter">
              <span className="bar">
                <i style={{ width: `${account.usage ?? 0}%` }} />
              </span>
              <span className="num">{account.usage === null ? "—" : `${account.usage}%`}</span>
            </span>
          </div>
          <div className="item">
            <div className="main">
              <div className="ttl">7 天窗口</div>
              <div className="desc">额度恢复后回到靠前的账号</div>
            </div>
            <span className="val">{account.usage === null ? "—" : "正常"}</span>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>绑定代理</h2>
        </div>
        <div className="group">
          <div className="item">
            <div className="main">
              <div className="ttl">{account.proxyName ?? "未绑定代理"}</div>
              <div className="desc mono">
                {account.proxyExit
                  ? `${account.proxyExit} · 登录与对话同一出口`
                  : "登录前需要绑定一个可用代理"}
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={onChangeProxy}>
              更换
            </Button>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>指纹</h2>
          <Button variant="plain" className="link" type="button" onClick={onEditFingerprint}>
            编辑
          </Button>
        </div>
        <div className="group">
          <div className="item">
            <div className="main">
              <div className="ttl">种子</div>
            </div>
            <span className="val mono">{account.fingerprint}</span>
          </div>
          <div className="item">
            <div className="main">
              <div className="ttl">浏览器</div>
            </div>
            <span className="val">
              {account.fingerprintDetail
                ? `${account.fingerprintDetail.brand} · ${account.fingerprintDetail.platform}`
                : "Chrome · macOS"}
            </span>
          </div>
          <div className="item">
            <div className="main">
              <div className="ttl">语言与时区</div>
            </div>
            <span className="val">
              {account.fingerprintDetail
                ? `${account.fingerprintDetail.lang} · ${account.fingerprintDetail.timezone}`
                : "en-US · America/Los_Angeles"}
            </span>
          </div>
        </div>
        <p className="note">下次重新授权时生效，已有的登录不受影响。</p>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>凭据</h2>
        </div>
        <div className="group">
          <div className="item">
            <div className="main">
              <div className="ttl">本机保存</div>
              <div className="desc">只用于本机中继替换 Authorization</div>
            </div>
            <span className={account.needsReauth ? "status bad" : "status ok"}>
              {account.needsReauth ? "需要重新授权" : "已保存"}
            </span>
          </div>
        </div>
      </section>
    </div>
  )
}
