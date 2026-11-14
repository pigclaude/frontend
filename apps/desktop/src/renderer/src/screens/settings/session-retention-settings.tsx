// 负责会话保留期设置。关闭时不限期保留，打开后才能调整天数。
import { useEffect, useState } from "react"
import { Button, SettingRow, SettingSection } from "@pigclaude/ui-primitives"
import { Switch } from "../../components/ui/switch"
import { Input } from "../../components/ui/input"
import type { SessionHistoryController } from "../../hooks/use-session-history"
import { useText } from "../../locale/text"

const firstDays = 30
const minimumDays = 1
const maximumDays = 36_500

/** 显示并编辑会话自动删除开关，成功保存后才更新已生效的天数。 */
export function SessionRetentionSettings({ history }: { history: SessionHistoryController }) {
  const { t } = useText()
  const saved = history.retention?.days ?? null
  const [days, setDays] = useState("")
  const [configuring, setConfiguring] = useState(false)
  useEffect(() => {
    setDays(String(saved ?? firstDays))
    setConfiguring(false)
  }, [saved])
  const number = Number(days)
  const valid = Number.isInteger(number) && number >= minimumDays && number <= maximumDays

  return (
    <SettingSection>
      {history.loadError === null ? null : (
        <p className="error-text" role="alert">
          {history.loadError}
        </p>
      )}
      <SettingRow
        title={t("shell.session.retention")}
        description={t("shell.session.retentionHint")}
      >
        <Switch
          aria-label={t("shell.session.retention")}
          checked={saved !== null || configuring}
          disabled={history.retention === null || history.saving}
          onCheckedChange={(next) => {
            if (!next && saved !== null) void history.saveRetention(null)
            else setConfiguring(next)
          }}
        />
      </SettingRow>
      {saved === null && !configuring ? null : (
        <SettingRow title={t("shell.session.retentionDays")}>
          <Input
            aria-label={t("shell.session.retentionDays")}
            type="number"
            min={minimumDays}
            max={maximumDays}
            step={1}
            value={days}
            disabled={history.saving}
            onChange={(event) => setDays(event.currentTarget.value)}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={!valid || number === saved || history.saving}
            onClick={() => void history.saveRetention(number)}
          >
            {t("shell.session.save")}
          </Button>
        </SettingRow>
      )}
    </SettingSection>
  )
}
