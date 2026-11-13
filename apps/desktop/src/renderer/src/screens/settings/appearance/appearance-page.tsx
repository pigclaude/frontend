// 负责呈现 Pigcode 外观页及 PigClaude 的 macOS 专属 Dock 图标。
import { AppearancePage as PigcodeAppearancePage } from "@pigclaude/ui-settings"
import {
  Button,
  resetAppearance,
  SettingRow,
  SettingSection,
  Switch,
} from "@pigclaude/ui-primitives"
import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../../components/ui/dialog"
import { ScrollPanel } from "@pigclaude/ui-shell"
import type { AppearanceController } from "../../../hooks/use-appearance"
import { useText } from "../../../locale/text"
import { DockIconPicker } from "./dock-icon-picker"

/** 外观与主题编辑由 Pigcode 提供，Dock 图标沿用 PigClaude 的本机选项。 */
export function AppearancePage({ appearance }: { appearance: AppearanceController }) {
  const { t } = useText()
  const [confirmReset, setConfirmReset] = useState(false)
  return (
    <ScrollPanel>
      <PigcodeAppearancePage appearance={appearance} />
      <div className="page narrow settings-page appearance-dock">
        <SettingSection title={t("appearance.additional")}>
          <SettingRow title={t("appearance.split")}>
            <Switch
              aria-label={t("appearance.split")}
              checked={appearance.settings.splitModes}
              onCheckedChange={(splitModes) =>
                appearance.update((current) => ({ ...current, splitModes }))
              }
            />
          </SettingRow>
          {window.pigclaude?.platform === "darwin" ? (
            <>
              <SettingRow
                title={t("appearance.dock.title")}
                description={t("appearance.dock.description")}
              >
                <DockIconPicker
                  value={appearance.settings.dockIcon}
                  onChange={(dockIcon) =>
                    appearance.update((current) => ({ ...current, dockIcon }))
                  }
                />
              </SettingRow>
              <SettingRow title={t("appearance.smoothing")}>
                <Switch
                  aria-label={t("appearance.smoothing")}
                  checked={appearance.settings.fontSmoothing}
                  onCheckedChange={(fontSmoothing) =>
                    appearance.update((current) => ({ ...current, fontSmoothing }))
                  }
                />
              </SettingRow>
            </>
          ) : null}
          <SettingRow title={t("appearance.reset")}>
            <Button size="sm" onClick={() => setConfirmReset(true)}>
              {t("appearance.reset")}
            </Button>
          </SettingRow>
        </SettingSection>
      </div>
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <div className="dialog-head">
            <DialogTitle>{t("appearance.reset")}</DialogTitle>
            <DialogDescription>{t("appearance.resetDescription")}</DialogDescription>
          </div>
          <div className="dialog-foot">
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              {t("appearance.cancel")}
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                appearance.update(resetAppearance)
                setConfirmReset(false)
              }}
            >
              {t("appearance.confirm")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ScrollPanel>
  )
}
