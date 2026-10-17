// 负责展示菜单栏状态、暂停切换和需要处理的账号。
import { useState } from "react"
import { Button } from "../components/ui/button"
import { Icon } from "../components/icon"
import { trayFixture } from "../fixtures/operations-fixtures"

/** 托盘预览页面 props。 */
export type TrayScreenProps = { onOpenAccounts: () => void; onOpenSettings?: () => void }

/** 绘制托盘面板预览。 */
export function TrayScreen({ onOpenAccounts, onOpenSettings }: TrayScreenProps) {
  const [paused, setPaused] = useState(false)
  return (
    <div className="tray-stage">
      <div className="tray">
        <div className="tray-head">
          <span className="app-ic">
            <Icon name="snout" />
          </span>
          <b>{paused ? "已暂停" : `${trayFixture.percent} · ${trayFixture.account}`}</b>
          <Button
            variant="plain"
            className="icon-btn"
            type="button"
            aria-label={paused ? "恢复自动切换" : "暂停自动切换"}
            onClick={() => setPaused((value) => !value)}
          >
            <Icon name={paused ? "play" : "pause"} />
          </Button>
        </div>
        <Button variant="plain" className="item" type="button" onClick={onOpenAccounts}>
          <span className="dot warn" />
          <div className="main">
            <div className="ttl">{trayFixture.attention}</div>
          </div>
          <Icon name="right" small />
        </Button>
        <div className="group">
          {trayFixture.accounts.map((account) => (
            <div className="item" key={account.name}>
              <span className="avatar">{account.mark}</span>
              <div className="main">
                <div className="ttl">{account.name}</div>
              </div>
              <span className="val">{account.usage}</span>
            </div>
          ))}
        </div>
        <div className="row tray-actions">
          <Button variant="ghost" size="sm" onClick={onOpenSettings}>
            设置
          </Button>
          <Button variant="ghost" size="sm" onClick={() => undefined}>
            打开主窗口
          </Button>
        </div>
      </div>
    </div>
  )
}
