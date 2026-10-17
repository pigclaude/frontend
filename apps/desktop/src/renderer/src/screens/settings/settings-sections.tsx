// 负责绘制账户、切换、通用、外观、会话、网络、隐私和关于设置。
import { useState } from "react"
import { Button } from "../../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog"
import { Switch } from "../../components/ui/switch"
import { settingsFixture } from "../../fixtures/operations-fixtures"
import { reducePrivacyState, validateRelayPort } from "../../models/operations-model"
import type { Screen } from "../screen"
import { SettingPage, SettingRow, SettingSection } from "./setting-page"

/** 设置页面 props。 */
export type SettingsScreenProps = {
  screen: Screen
  onNavigate: (screen: Screen) => void
  onLogout: () => void
}

/** 根据当前设置子页绘制原型对应的设置内容。 */
export function SettingsScreen({ screen, onNavigate, onLogout }: SettingsScreenProps) {
  const [privacy, setPrivacy] = useState({ open: false, cleared: false })
  const [port, setPort] = useState<string>(settingsFixture.relayPort)
  if (screen === "profile")
    return (
      <SettingPage title="我的账户" sub="登录 pigclaude 的账户，只用来确认你能不能使用这套软件">
        <SettingSection title="账户">
          <SettingRow
            title={settingsFixture.accountName}
            description={settingsFixture.accountEmail}
            value="已开通"
          />
          <SettingRow
            title="上次校验"
            description="连不上服务时沿用上次通过的结果"
            value="今天 09:00 · 本机"
          />
        </SettingSection>
        <div className="setup-actions">
          <Button variant="secondary" onClick={onLogout}>
            退出登录
          </Button>
        </div>
      </SettingPage>
    )
  if (screen === "switching")
    return (
      <SettingPage title="切换规则" sub="什么时候从一个 Claude 账号换到下一个">
        <SettingSection title="窗口">
          <SettingRow
            title="5 小时窗口"
            description="用到这个比例就换；100% 表示用尽才换"
            value="100%"
          />
          <SettingRow title="7 天窗口" description="计入 Opus 每周额度" value="100%" />
          <SettingRow title="额度恢复后" description="回到靠前的账号">
            <Switch defaultChecked aria-label="额度恢复后回到靠前账号" />
          </SettingRow>
        </SettingSection>
        <p className="note">
          响应体开始写出后不再换号；请求体超过 32 MiB 不重放。顺序在 Claude 账号里拖动调整。
        </p>
      </SettingPage>
    )
  if (screen === "general")
    return (
      <SettingPage title="通用">
        <SettingSection title="启动">
          <SettingRow title="开机自动启动" description="中继随应用常驻后台">
            <Switch defaultChecked aria-label="开机自动启动" />
          </SettingRow>
          <SettingRow title="在 Dock 中显示" description="关闭后只出现在菜单栏">
            <Switch defaultChecked aria-label="在 Dock 中显示" />
          </SettingRow>
          <SettingRow title="自动检查更新" value="当前 0.1.0，已是最新" />
        </SettingSection>
      </SettingPage>
    )
  if (screen === "appearance")
    return (
      <SettingPage title="外观">
        <SettingSection title="主题">
          <SettingRow title="主题">
            <div className="seg">
              <button className="is-active" type="button">
                浅色
              </button>
              <button type="button">深色</button>
              <button type="button">跟随系统</button>
            </div>
          </SettingRow>
          <SettingRow title="侧栏会话" value="按项目" />
        </SettingSection>
      </SettingPage>
    )
  if (screen === "session")
    return (
      <SettingPage title="会话" sub="新会话的默认值，以及会话进程怎么运行">
        <SettingSection title="默认值">
          <SettingRow title="默认工作区" value="~/workspace/pigclaude/frontend" />
          <SettingRow title="默认模型" value="Sonnet 5.5" />
          <SettingRow title="默认权限" value="每次询问" />
        </SettingSection>
        <SettingSection title="会话进程">
          <SettingRow
            title="Claude Code"
            description="无界面运行，由 Agent SDK 驱动"
            value="内置 2.1.296"
          />
          <SettingRow
            title="读取 ~/.claude/settings.json"
            description="会话的地址和凭据只由 pigclaude 决定"
            value="始终关闭"
          />
          <SettingRow title="时区与语言" value="跟随代理出口" />
        </SettingSection>
      </SettingPage>
    )
  if (screen === "network")
    return (
      <SettingPage title="中继与网络">
        <SettingSection title="中继">
          <SettingRow title="中继端口" description="只监听 127.0.0.1">
            <input
              className={validateRelayPort(port) ? "input mono" : "input mono is-error"}
              value={port}
              onChange={(event) => setPort(event.target.value)}
              aria-label="中继端口"
            />
            <span className="status ok">运行中</span>
          </SettingRow>
          <SettingRow title="代理不通时" value="请求失败，不走直连" />
          <SettingRow title="出口复查" value="每 15 分钟" />
        </SettingSection>
      </SettingPage>
    )
  if (screen === "data")
    return (
      <SettingPage title="数据与隐私" sub="所有数据都在这台电脑上">
        <SettingSection title="数据目录">
          <SettingRow title="数据目录" value={settingsFixture.dataDir} />
          <SettingRow
            title="accounts.json"
            description="Claude 账号的凭据与指纹，明文保存"
            value="6.2 KB"
          />
          <SettingRow title="proxies.json" description="代理地址与认证信息" value="1.1 KB" />
        </SettingSection>
        <p className="note">凭据没有加密。请确认这台电脑只有你在用，并开启磁盘加密。</p>
        <SettingSection title="用量记录">
          <SettingRow title="保存内容" description="只有元数据，不含提示词和回复" value="90 天" />
          <SettingRow title="清除用量记录">
            <Button
              variant="danger"
              size="sm"
              onClick={() => setPrivacy(reducePrivacyState(privacy, { type: "open-clear" }))}
            >
              清除
            </Button>
          </SettingRow>
        </SettingSection>
        <Dialog
          open={privacy.open}
          onOpenChange={(open) => setPrivacy((state) => ({ ...state, open }))}
        >
          <DialogContent>
            <div className="dialog-head">
              <DialogTitle>清除全部用量记录？</DialogTitle>
              <DialogDescription>Claude 账号、代理和会话都不受影响。</DialogDescription>
            </div>
            <div className="dialog-foot">
              <Button
                variant="ghost"
                onClick={() => setPrivacy(reducePrivacyState(privacy, { type: "cancel-clear" }))}
              >
                取消
              </Button>
              <Button
                variant="solidDanger"
                onClick={() => setPrivacy(reducePrivacyState(privacy, { type: "confirm-clear" }))}
              >
                清除
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </SettingPage>
    )
  return (
    <SettingPage title="关于">
      <SettingSection title="pigclaude">
        <SettingRow title="本机用你自己的 Claude 订阅号池" value={settingsFixture.version} />
        <SettingRow title="内置 Claude Code" value={settingsFixture.claudeVersion} />
      </SettingSection>
      <div className="setup-actions">
        <Button variant="secondary" onClick={() => onNavigate("chat")}>
          返回会话
        </Button>
      </div>
    </SettingPage>
  )
}
