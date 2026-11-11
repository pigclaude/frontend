// 负责指纹设置面板：环境摘要、快捷预设、分组标签、设置页样式的小组卡片和字段校验定位。
// 授权向导与账号编辑共用此面板，切换分组时由调用方保留完整草稿。

import { useEffect, useRef, useState } from "react"
import type { ClaudeFingerprintView } from "@pigclaude/contracts/claude-account"
import { cn } from "../lib/cn"
import {
  fingerprintEnvironmentChips,
  fingerprintGroups,
  fingerprintHeadline,
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
  errors?: FingerprintFormErrors | undefined
  idPrefix: string
  onChange: (value: ClaudeFingerprintView) => void
}

/** 渲染指纹设置；提交出现错误时自动切到第一个有错误的分组，并聚焦出错的控件。 */
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
  const descriptionId = `${idPrefix}-panel-${group.id}-description`

  return (
    <div className="fingerprint-form">
      <div className="fp-toolbar">
        <div className="fp-environment">
          <span className="fp-environment-icon">
            <Icon name="finger" />
          </span>
          <div className="fp-environment-text">
            <div className="fp-environment-name">{fingerprintHeadline(value)}</div>
            <div className="fp-chips">
              {fingerprintEnvironmentChips(value).map((chip, index) => (
                <span key={index} className={cn("fp-chip", chip.mono && "mono")}>
                  {chip.text}
                </span>
              ))}
            </div>
          </div>
        </div>
        <FingerprintPresetPicker value={value} idPrefix={idPrefix} onChange={onChange} />
      </div>
      <div className="fp-tabs-bar">
        <RadioGroup
          className="seg fp-tabs"
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
                className="seg-item fp-tab"
              >
                <span>{item.title}</span>
                {count > 0 ? (
                  <span className="fp-error-count" aria-label={`${count} 处待修正`}>
                    {count}
                  </span>
                ) : null}
              </RadioGroupCard>
            )
          })}
        </RadioGroup>
        <p className="fp-group-description" id={descriptionId}>
          {group.description}
        </p>
      </div>
      <section
        ref={panel}
        className="fp-content"
        id={`${idPrefix}-panel-${group.id}`}
        aria-labelledby={`${idPrefix}-group-${group.id}`}
        aria-describedby={descriptionId}
        key={group.id}
      >
        {group.sections.map((section) => (
          <section className="section fp-section" key={section.title}>
            <div className="section-head">
              <h3>{section.title}</h3>
            </div>
            {section.description ? (
              <p className="fp-section-note" id={`${idPrefix}-${section.fields[0]}-hint`}>
                {section.description}
              </p>
            ) : null}
            <div className="group">
              {section.fields.map((fieldKey) => (
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
        ))}
      </section>
    </div>
  )
}
