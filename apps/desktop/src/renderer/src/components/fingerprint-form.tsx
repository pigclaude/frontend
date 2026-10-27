// 负责指纹设置面板：环境摘要、快捷预设、分组导航和字段校验定位。
// 授权向导与账号编辑共用此面板，切换分组时由调用方保留完整草稿。

import { useEffect, useRef, useState } from "react"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import {
  fingerprintGroups,
  fingerprintHeadline,
  fingerprintLocaleLine,
  type FingerprintFormErrors,
  type FingerprintGroupId,
} from "../models/fingerprint-form"
import { FingerprintField } from "./fingerprint-field"
import { FingerprintPresetPicker } from "./fingerprint-preset-picker"
import { Icon } from "./icon"
import { RadioGroup, RadioGroupCard } from "./ui/radio-group"

/** 指纹表单的受控草稿、字段错误与稳定控件标识。 */
export type FingerprintFormProps = {
  value: ClaudeFingerprintView
  errors?: FingerprintFormErrors
  idPrefix: string
  onChange: (value: ClaudeFingerprintView) => void
}

const navigation: Record<FingerprintGroupId, { icon: string; detail: string }> = {
  identity: { icon: "browser", detail: "浏览器、语言与时区" },
  device: { icon: "server", detail: "窗口、硬件与网络" },
  compat: { icon: "shield", detail: "噪声与特征伪装" },
  advanced: { icon: "terminal", detail: "自定义启动参数" },
}

/** 渲染指纹设置；提交出现错误时自动切到第一个有错误的分组。 */
export function FingerprintForm({ value, errors = {}, idPrefix, onChange }: FingerprintFormProps) {
  const [active, setActive] = useState<FingerprintGroupId>("identity")
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    const invalid = fingerprintGroups.find((group) => group.fields.some((key) => errors[key]))
    if (invalid) setActive(invalid.id)
  }, [errors])

  useEffect(() => {
    const invalid =
      panel.current?.querySelector<HTMLElement>(
        'input[aria-invalid="true"], textarea[aria-invalid="true"]',
      ) ?? panel.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
    invalid?.focus()
  }, [active, errors])

  const group = fingerprintGroups.find((item) => item.id === active) ?? fingerprintGroups[0]
  if (!group) return null

  return (
    <div className="fingerprint-form">
      <div className="fp-toolbar">
        <div className="fp-environment">
          <span className="fp-environment-icon">
            <Icon name="finger" />
          </span>
          <div>
            <div className="fp-environment-name">{fingerprintHeadline(value)}</div>
            <p>{fingerprintLocaleLine(value)}</p>
          </div>
        </div>
        <FingerprintPresetPicker value={value} idPrefix={idPrefix} onChange={onChange} />
      </div>
      <div className="fp-workspace">
        <div className="fp-sidebar">
          <RadioGroup
            className="fp-navigation"
            aria-label="指纹设置分组"
            value={active}
            onValueChange={(next) => {
              const selected = fingerprintGroups.find((item) => item.id === next)
              if (selected) setActive(selected.id)
            }}
          >
            {fingerprintGroups.map((item) => {
              const count = item.fields.filter((key) => errors[key]).length
              return (
                <RadioGroupCard
                  key={item.id}
                  id={`${idPrefix}-group-${item.id}`}
                  value={item.id}
                  aria-controls={`${idPrefix}-panel-${item.id}`}
                  className="fp-nav-item"
                >
                  <Icon name={navigation[item.id].icon} small />
                  <span>
                    <strong>{item.title}</strong>
                    <span className="fp-nav-detail">{navigation[item.id].detail}</span>
                  </span>
                  {count > 0 ? (
                    <span className="fp-error-count" aria-label={`${count} 处待修正`}>
                      {count}
                    </span>
                  ) : null}
                </RadioGroupCard>
              )
            })}
          </RadioGroup>
          <p className="fp-sidebar-note">
            <Icon name="lock" small />
            配置随账号单独保存
          </p>
        </div>
        <section
          ref={panel}
          className="fp-content"
          id={`${idPrefix}-panel-${group.id}`}
          aria-labelledby={`${idPrefix}-group-${group.id}`}
          key={group.id}
        >
          <header className="fp-section-heading">
            <h2>{group.title}</h2>
            <p>{group.description}</p>
          </header>
          <div className="fp-fields">
            {group.fields.map((fieldKey) => (
              <FingerprintField
                key={fieldKey}
                fieldKey={fieldKey}
                value={value}
                errors={errors}
                idPrefix={idPrefix}
                onChange={onChange}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
