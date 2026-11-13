// 为账号绑定和 CLI 导入选择共享环境配置，不提供共享登录数据的选项。

import { desktopText } from "../locale/text"
import type { BrowserProfileView } from "@pigclaude/contracts/browser-profile"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"

/** 配置选择所需的脱敏列表和受控 id。 */
export type BrowserProfileSelectProps = {
  id: string
  profiles: BrowserProfileView[]
  value: string
  onChange: (id: string) => void
}

/** 配置可被多个账号引用；运行中的配置仍可复用，只有编辑受到限制。value 为空串表示尚未选择。 */
export function BrowserProfileSelect({ id, profiles, value, onChange }: BrowserProfileSelectProps) {
  const known = profiles.some((profile) => profile.id === value)
  return (
    <div className="field">
      <label htmlFor={id}>{desktopText("pool.browser-profile-select.1")}</label>
      <Select value={known ? value : ""} onValueChange={onChange}>
        <SelectTrigger id={id}>
          <SelectValue placeholder={desktopText("pool.browser-profile-select.2")} />
        </SelectTrigger>
        <SelectContent>
          {profiles.map((profile) => (
            <SelectItem key={profile.id} value={profile.id}>
              {profile.name} · {profile.fingerprint.lang} · {profile.fingerprint.timezone}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!profiles.length ? (
        <p className="note">{desktopText("pool.browser-profile-select.3")}</p>
      ) : null}
    </div>
  )
}
