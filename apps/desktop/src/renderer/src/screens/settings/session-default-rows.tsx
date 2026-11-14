// 负责新会话默认设置的三行：默认模型、默认权限（设为完全访问前二次确认）和新会话账号。
// 设置只存在本机，由 useSessionDefaults 读写；保存失败时提示，界面保持原值。

import { useState } from "react"
import type { ClaudeAccountView } from "@pigclaude/contracts/claude-account"
import { RUNTIME_MODE_OPTIONS, localizeText, type RuntimeMode } from "@pigclaude/ui-contracts"
import { useToast } from "@pigclaude/ui-shell"
import { Button } from "../../components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog"
import { useSessionDefaults } from "../../hooks/use-session-defaults"
import { desktopText, useText } from "../../locale/text"
import {
  DEFAULT_PERMISSION_LEVEL,
  composerLevel,
  permissionView,
  sessionPermissionMode,
} from "../../models/composer-config"
import type { ClaudeModel } from "../../../../main/session/session-types"
import type {
  DefaultPermissionMode,
  SessionDefaultsPatch,
} from "../../../../session-defaults-contract"
import { SelectControl } from "./setting-controls"
import { SettingRow } from "./setting-page"

const AUTO_ACCOUNT = "auto"

function useSave(): (patch: SessionDefaultsPatch) => void {
  const { save } = useSessionDefaults()
  const toast = useToast()
  return (patch) => {
    void save(patch).catch(() => toast(desktopText("settings.defaults.saveFailed"), "alert"))
  }
}

/**
 * 默认模型：从 Claude Code 的模型目录里选。选中目录标为默认的那一项时存为跟随 Claude Code；
 * 目录还没读到时显示「—」。存过的模型已不在目录里时仍列出它，新会话会改用 Claude Code 的默认。
 */
export function DefaultModelRow({ models }: { models: readonly ClaudeModel[] }) {
  const { defaults } = useSessionDefaults()
  const save = useSave()
  const title = desktopText("settings.settings-app-pages.20")
  const fallback = models.find((model) => model.isDefault) ?? models[0]
  if (fallback === undefined) return <SettingRow title={title} value="—" />
  const options = models.map((model) => ({ value: model.id, label: model.displayName }))
  if (defaults.model !== null && !models.some((model) => model.id === defaults.model)) {
    options.push({ value: defaults.model, label: defaults.model })
  }
  return (
    <SettingRow title={title}>
      <SelectControl
        label={desktopText("settings.settings-app-pages.21")}
        value={defaults.model ?? fallback.id}
        options={options}
        width={200}
        onChange={(id) => save({ model: id === fallback.id && fallback.isDefault ? null : id })}
      />
    </SettingRow>
  )
}

/** 默认权限：四个档位，计划不作为默认；选完全访问时先弹确认，确认后才保存。 */
export function DefaultPermissionRow() {
  const { locale } = useText()
  const { defaults } = useSessionDefaults()
  const save = useSave()
  const [confirming, setConfirming] = useState(false)
  const level = permissionView(defaults.permissionMode, DEFAULT_PERMISSION_LEVEL).level
  const choose = (next: RuntimeMode) => save({ permissionMode: permissionModeOf(next) })
  return (
    <SettingRow
      title={desktopText("settings.settings-app-pages.22")}
      description={desktopText("settings.settings-app-pages.23")}
    >
      <SelectControl
        label={desktopText("settings.settings-app-pages.24")}
        value={level}
        options={RUNTIME_MODE_OPTIONS.map((mode) => ({
          value: mode.id,
          label: localizeText(mode.label, locale),
        }))}
        width={160}
        onChange={(id) => {
          const next = composerLevel(id)
          if (next === null || next === level) return
          if (next === "full-access") setConfirming(true)
          else choose(next)
        }}
      />
      <FullAccessDialog
        open={confirming}
        onOpenChange={setConfirming}
        onConfirm={() => {
          setConfirming(false)
          choose("full-access")
        }}
      />
    </SettingRow>
  )
}

/** 新会话账号：自动选择，或优先号池里的某个账号；存过的账号已删除时显示自动选择。 */
export function DefaultAccountRow({ accounts }: { accounts: readonly ClaudeAccountView[] }) {
  const { defaults } = useSessionDefaults()
  const save = useSave()
  const known = accounts.some((account) => account.id === defaults.accountId)
  return (
    <SettingRow
      title={desktopText("settings.defaults.account")}
      description={desktopText("settings.defaults.accountDescription")}
    >
      <SelectControl
        label={desktopText("settings.defaults.account")}
        value={known && defaults.accountId !== null ? defaults.accountId : AUTO_ACCOUNT}
        options={[
          { value: AUTO_ACCOUNT, label: desktopText("settings.defaults.autoAccount") },
          ...accounts.map((account) => ({ value: account.id, label: account.displayName })),
        ]}
        width={200}
        onChange={(id) => save({ accountId: id === AUTO_ACCOUNT ? null : id })}
      />
    </SettingRow>
  )
}

// 计划开关关着时得到的模式不会是 plan；类型上收窄到能作为默认的四档。
function permissionModeOf(level: RuntimeMode): DefaultPermissionMode {
  const mode = sessionPermissionMode(level, false)
  return mode === "plan" ? "default" : mode
}

function FullAccessDialog({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <div className="dialog-head">
          <div className="dialog-heading">
            <DialogTitle className="dialog-title">
              {desktopText("settings.defaults.fullAccessTitle")}
            </DialogTitle>
            <DialogDescription className="dialog-desc">
              {desktopText("settings.defaults.fullAccessDescription")}
            </DialogDescription>
          </div>
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {desktopText("settings.defaults.cancel")}
          </Button>
          <Button variant="solidDanger" onClick={onConfirm}>
            {desktopText("settings.defaults.confirmFullAccess")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
