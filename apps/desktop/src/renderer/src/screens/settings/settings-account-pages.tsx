// 负责「我的账户」和「切换规则」两个设置页。
import { WithdrawAuthorization } from "../../components/withdraw-authorization"
import { useState } from "react"
import { Icon } from "../../components/icon"
import { useToast } from "../../components/toast"
import { Button } from "../../components/ui/button"
import { Switch } from "../../components/ui/switch"
import { settingsFixture } from "../../fixtures/operations-fixtures"
import type { Screen } from "../screen"
import { RangeControl } from "./setting-controls"
import { SettingPage, SettingRow, SettingSection } from "./setting-page"

/** 我的账户：pigclaude 使用权限，不涉及 Claude 订阅账号。 */
export function ProfileSettings({
  onLogout,
  withdrawContextId,
}: {
  onLogout: () => void
  withdrawContextId?: string
}) {
  const toast = useToast()
  return (
    <SettingPage title="我的账户" sub="登录 pigclaude 的账户，只用来确认你能不能使用这套软件">
      <div className="group">
        <div className="me">
          <span className="avatar lg">林</span>
          <div className="grow">
            <div className="me-name">{settingsFixture.accountName}</div>
            <div className="muted">{settingsFixture.accountEmail}</div>
          </div>
          <Button size="sm" onClick={() => toast("已在浏览器打开资料页", "external")}>
            编辑资料
          </Button>
        </div>
      </div>
      <SettingSection title="使用权限">
        <SettingRow title="状态">
          <span className="status ok">已开通</span>
        </SettingRow>
        <SettingRow
          title="上次校验"
          description="连不上服务时，沿用上次通过的结果"
          value="今天 09:00 · 联网"
        />
      </SettingSection>
      <SettingSection title="登录">
        <SettingRow title="登录方式" description="在系统浏览器里完成，桌面端不接触密码">
          <span className="val">浏览器授权</span>
        </SettingRow>
        <SettingRow title="这台电脑" value="MacBook Pro · 当前设备" />
      </SettingSection>
      <p className="note">
        <Icon name="lock" small />
        Claude 账号、凭据、代理和指纹只保存在这台电脑上，不会上传到你的 pigclaude 账户。
      </p>
      <div className="setup-actions">
        <WithdrawAuthorization contextId={withdrawContextId} />
        <Button onClick={onLogout}>
          <Icon name="exit" />
          退出登录
        </Button>
      </div>
    </SettingPage>
  )
}

/** 切换规则：什么时候从一个 Claude 账号换到下一个。 */
export function SwitchingSettings({ onNavigate }: { onNavigate: (screen: Screen) => void }) {
  const [fiveHour, setFiveHour] = useState(100)
  const [sevenDay, setSevenDay] = useState(100)
  return (
    <SettingPage title="切换规则" sub="什么时候从一个 Claude 账号换到下一个">
      <SettingSection>
        <SettingRow title="5 小时窗口" description="用到这个比例就换；100% 表示用尽才换">
          <RangeControl
            label="5 小时阈值"
            value={fiveHour}
            min={50}
            max={100}
            step={5}
            onChange={setFiveHour}
          />
        </SettingRow>
        <SettingRow title="7 天窗口">
          <RangeControl
            label="7 天阈值"
            value={sevenDay}
            min={50}
            max={100}
            step={5}
            onChange={setSevenDay}
          />
        </SettingRow>
        <SettingRow title="计入 Opus 每周额度" description="到 90% 时，Opus 请求换到下一个账号">
          <Switch defaultChecked aria-label="计入 Opus 每周额度" />
        </SettingRow>
        <SettingRow title="额度恢复后回到靠前的账号">
          <Switch defaultChecked aria-label="额度恢复后回到靠前的账号" />
        </SettingRow>
      </SettingSection>
      <p className="note">
        <Icon name="info" small />
        <span>
          响应体开始写出后不再换号；请求体超过 32 MiB 不重放。顺序在{" "}
          <Button
            variant="plain"
            className="link"
            type="button"
            onClick={() => onNavigate("accounts")}
          >
            Claude 账号
          </Button>{" "}
          里拖动调整。
        </span>
      </p>
    </SettingPage>
  )
}
