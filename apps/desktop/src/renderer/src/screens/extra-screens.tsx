// 负责托盘面板预览；首次引导和账号授权已经拆到独立页面。
import { Icon } from "../components/icon"

/** 菜单栏状态和托盘面板。 */
export function TrayScreen({ onOpenAccounts }: { onOpenAccounts: () => void }) {
  return (
    <div className="tray-stage">
      <div className="tray">
        <div className="row">
          <Icon name="snout" />
          <b>62% · 主力</b>
        </div>
        <button className="item" type="button" onClick={onOpenAccounts}>
          <span className="dot warn" />
          <div className="main">
            <div className="ttl">旧号 Pro 需要重新授权</div>
          </div>
          <Icon name="right" small />
        </button>
        <div className="group">
          <div className="item">
            <span className="avatar">主</span>
            <div className="main">
              <div className="ttl">主力 Max</div>
            </div>
            <span className="val">62%</span>
          </div>
          <div className="item">
            <span className="avatar">备</span>
            <div className="main">
              <div className="ttl">备用 Pro</div>
            </div>
            <span className="val">8%</span>
          </div>
        </div>
      </div>
    </div>
  )
}
