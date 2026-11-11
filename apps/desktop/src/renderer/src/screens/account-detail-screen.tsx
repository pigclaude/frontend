// 负责展示单个 Claude 账号的额度、网络出口、指纹和凭据状态。
import { Button } from "../components/ui/button"
import { Icon } from "../components/icon"
import { FingerprintSummary } from "../components/fingerprint-summary"
import type { PoolAccount } from "../fixtures/pool-fixtures"
import { accountNetworkLabel } from "../models/claude-account-view"

/** 账号详情页面 props。 */
export type AccountDetailScreenProps = {
  account: PoolAccount
  browserProfileName?: string | undefined
  onChangeBrowserProfile?: () => void
  onBack: () => void
  onReauthorize: () => void
  onDelete: () => void
  onToggleEnabled: () => void
  onChangeProxy: () => void
  onEditFingerprint: () => void
}

/** 绘制账号详情和操作入口。 */
export function AccountDetailScreen({
  account,
  browserProfileName,
  onChangeBrowserProfile,
  onBack,
  onReauthorize,
  onDelete,
  onToggleEnabled,
  onChangeProxy,
  onEditFingerprint,
}: AccountDetailScreenProps) {
  return (
    <div className="page narrow">
      <Button variant="plain" className="back" type="button" onClick={onBack}>
        <Icon name="left" small />
        账号
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
          <Button variant="secondary" onClick={onToggleEnabled}>
            {account.enabled ? "停用" : "启用"}
          </Button>
          <Button variant="danger" onClick={onDelete}>
            删除
          </Button>
        </div>
      </header>
      {account.browserProfileId ? (
        <section className="section">
          <div className="section-head">
            <h2>浏览器配置</h2>
          </div>
          <div className="group">
            <div className="item">
              <div className="main">
                <div className="ttl">{browserProfileName ?? "关联配置"}</div>
                <div className="desc">
                  浏览器与 CLI 使用相同语言、时区和网络设置；账号登录数据独立。
                </div>
              </div>
              <Button size="sm" variant="secondary" onClick={onChangeBrowserProfile}>
                更换配置
              </Button>
            </div>
          </div>
        </section>
      ) : null}
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
          {account.statusKind === "cooldown" ? (
            <div className="item">
              <div className="main">
                <div className="ttl">额度冷却</div>
                <div className="desc">恢复前不参与自动切换</div>
              </div>
              <span className="status warn">{cooldownText(account.cooldownUntil)}</span>
            </div>
          ) : null}
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>网络出口</h2>
        </div>
        <div className="group">
          <div className="item">
            <div className="main">
              <div className="ttl">{accountNetworkLabel(account)}</div>
              <div className="desc mono">
                {account.proxyId === null
                  ? "登录与对话使用本机网络，不走代理"
                  : account.proxyExit
                    ? `${account.proxyExit} · 登录与对话同一出口`
                    : "代理已不可用，请更换或改为系统网络"}
              </div>
            </div>
            <Button size="sm" variant="secondary" onClick={onChangeProxy}>
              设置
            </Button>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="section-head">
          <h2>指纹</h2>
          <Button variant="plain" className="link" type="button" onClick={onEditFingerprint}>
            {account.browserProfileId ? "编辑共享配置" : "编辑"}
          </Button>
        </div>
        <FingerprintSummary
          fingerprint={account.fingerprintDetail}
          fallbackSeed={account.fingerprint}
        />
        <p className="note">
          {account.browserProfileId
            ? "环境修改统一在「浏览器指纹」中管理，影响引用该配置账号的后续启动；各账号不共享登录数据。"
            : "下次重新授权时生效，已有的登录不受影响。"}
        </p>
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

function cooldownText(value: string | null): string {
  if (value === null) return "冷却中"
  const until = Date.parse(value)
  if (!Number.isFinite(until)) return "冷却中"
  return `${new Date(until).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 后恢复`
}
