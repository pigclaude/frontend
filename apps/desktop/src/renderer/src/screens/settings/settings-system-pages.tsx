// 负责「中继与网络」「数据与隐私」「关于」三个设置页。
import { useState } from "react"
import { Icon } from "../../components/icon"
import { useToast } from "@pigclaude/ui-shell"
import { Button } from "../../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog"
import { reducePrivacyState } from "../../models/operations-model"
import { LockedValue, SelectControl } from "./setting-controls"
import { SettingPage, SettingRow, SettingSection } from "./setting-page"

/** 中继与网络：端口当场校验，代理不通时的行为固定为失败。 */
export function NetworkSettings() {
  const toast = useToast()
  const [recheck, setRecheck] = useState("每 30 分钟")
  return (
    <SettingPage title="中继与网络">
      <SettingSection title="中继">
        <SettingRow title="中继端口" description="本机运行时信息尚未接入" value="—" />
        <SettingRow title="重启中继" description="运行时信息尚未接入">
          <Button size="sm" onClick={() => toast("中继已重启", "refresh")}>
            重启
          </Button>
        </SettingRow>
      </SettingSection>
      <SettingSection title="代理">
        <SettingRow
          title="代理可选"
          description="未绑定代理的账号使用系统网络；已绑定代理的请求不会直连"
        >
          <LockedValue>按账号绑定</LockedValue>
        </SettingRow>
        <SettingRow title="代理不通时" description="已绑定代理的请求失败，不会回退到系统网络直连">
          <LockedValue>请求失败，不走直连</LockedValue>
        </SettingRow>
        <SettingRow title="出口复查" description="确认已绑定代理的出口 IP 和授权时一致">
          <SelectControl
            label="出口复查间隔"
            value={recheck}
            width={120}
            options={["每 15 分钟", "每 30 分钟", "每小时"]}
            onChange={setRecheck}
          />
        </SettingRow>
      </SettingSection>
    </SettingPage>
  )
}

/** 数据与隐私：数据目录、明文凭据提醒和清除用量记录。 */
export function DataSettings({ userDataPath }: { userDataPath: string | null }) {
  const toast = useToast()
  const [privacy, setPrivacy] = useState({ open: false, cleared: false })
  const [retention, setRetention] = useState("90 天")
  return (
    <SettingPage title="数据与隐私" sub="所有数据都在这台电脑上">
      <SettingSection title="数据目录">
        <SettingRow title="数据目录" description={userDataPath ?? "—"} mono>
          <Button size="sm" onClick={() => toast("已在访达中显示", "folder")}>
            在访达中显示
          </Button>
        </SettingRow>
        <SettingRow
          title={<span className="mono">accounts.json</span>}
          description="Claude 账号的凭据与指纹，明文保存"
          value="—"
        />
        <SettingRow
          title={<span className="mono">proxies.json</span>}
          description="代理地址与认证信息"
          value="—"
        />
      </SettingSection>
      <p className="note">
        <Icon name="alert" small className="t-warn" />
        凭据没有加密。请确认这台电脑只有你在用，并开启磁盘加密。
      </p>
      <SettingSection title="用量记录">
        <SettingRow title="保留" description="只有元数据，不含提示词和回复">
          <SelectControl
            label="保留时长"
            value={retention}
            width={110}
            options={["30 天", "90 天", "1 年"]}
            onChange={setRetention}
          />
        </SettingRow>
        <SettingRow
          title="清除用量记录"
          description={privacy.cleared ? "已清除，新的请求会重新开始记录" : "—"}
        >
          <Button
            variant="danger"
            size="sm"
            disabled={privacy.cleared}
            onClick={() => setPrivacy(reducePrivacyState(privacy, { type: "open-clear" }))}
          >
            {privacy.cleared ? "已清除" : "清除"}
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
              onClick={() => {
                setPrivacy(reducePrivacyState(privacy, { type: "confirm-clear" }))
                toast("用量记录已清除", "trash")
              }}
            >
              清除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </SettingPage>
  )
}

/** 关于：版本信息和检查更新。 */
export function AboutSettings({ appVersion }: { appVersion: string | null }) {
  const toast = useToast()
  return (
    <SettingPage title="关于">
      <div className="group">
        <div className="me">
          <span className="about-mark">
            <Icon name="snout" />
          </span>
          <div className="grow">
            <div className="me-name">pigclaude</div>
            <div className="muted">在本机用你自己的 Claude 订阅号池</div>
          </div>
          <Button size="sm" onClick={() => toast("已是最新版本", "check")}>
            检查更新
          </Button>
        </div>
      </div>
      <SettingSection title="版本">
        <SettingRow title="pigclaude" value={appVersion ?? "—"} />
        <SettingRow title="内置 Claude Code" value="—" />
      </SettingSection>
    </SettingPage>
  )
}
