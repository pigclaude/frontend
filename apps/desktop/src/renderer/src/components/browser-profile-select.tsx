// 为账号绑定和 CLI 导入选择共享环境配置，不提供共享登录数据的选项。

import type { BrowserProfileView } from "@pigclaude/contracts/browser-profile"

/** 配置选择所需的脱敏列表和受控 id。 */
export type BrowserProfileSelectProps = {
  id: string
  profiles: BrowserProfileView[]
  value: string
  onChange: (id: string) => void
}

/** 配置可被多个账号引用；运行中的配置仍可复用，只有编辑受到限制。 */
export function BrowserProfileSelect({ id, profiles, value, onChange }: BrowserProfileSelectProps) {
  return (
    <div className="field">
      <label htmlFor={id}>浏览器配置</label>
      <select
        id={id}
        className="browser-profile-select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">请选择浏览器配置</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name} · {profile.fingerprint.lang} · {profile.fingerprint.timezone}
          </option>
        ))}
      </select>
      {!profiles.length ? <p className="note">请先在号池的「浏览器指纹」中创建配置。</p> : null}
    </div>
  )
}
