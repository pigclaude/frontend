// 负责按 AntBrowser 分组渲染完整指纹表单：快速预设、身份、设备、兼容和高级原始参数。
// 表单只做展示和草稿编辑，校验结果由调用方传入并显示在对应字段下。

import type { ReactNode } from "react"
import type {
  ClaudeFingerprintView,
  FingerprintNoise,
  FingerprintSpoofingCategory,
  FingerprintWebrtcPolicy,
} from "@pigclaude/contracts/claude-account"
import { cn } from "../lib/cn"
import {
  advancedFingerprintProfiles,
  applyFingerprintPreset,
  fingerprintFieldMeta,
  fingerprintGroups,
  fingerprintNoiseOptions,
  fingerprintSpoofingCategories,
  formatUnknownArgs,
  quickFingerprintPresets,
  splitUnknownArgs,
  type FingerprintFieldKey,
  type FingerprintFormErrors,
  type FingerprintPreset,
} from "../models/fingerprint-form"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"

/** 指纹表单 props。idPrefix 用于生成稳定可测的表单 id。 */
export type FingerprintFormProps = {
  value: ClaudeFingerprintView
  errors?: FingerprintFormErrors
  idPrefix: string
  onChange: (value: ClaudeFingerprintView) => void
}

/** 只接受普通字符串的字段键，排除噪声、伪装类别和原始参数。 */
type PlainTextFieldKey = Exclude<
  FingerprintFieldKey,
  "webrtcPolicy" | "canvasNoise" | "clientRectsNoise" | "disableSpoofing" | "unknownArgs"
>

/** 渲染完整指纹表单。保证所有分组和预设都来自同一份元数据。 */
export function FingerprintForm({ value, errors = {}, idPrefix, onChange }: FingerprintFormProps) {
  function updateField<K extends FingerprintFieldKey>(
    key: K,
    next: ClaudeFingerprintView[K],
  ): void {
    onChange({ ...value, [key]: next })
  }

  function setTextValue(key: PlainTextFieldKey, next: string): void {
    updateField(key, next)
  }

  function setSelectValue(
    key: "brand" | "platform" | "webrtcPolicy" | "resolution",
    next: string,
  ): void {
    if (key === "webrtcPolicy") {
      updateField(key, next as FingerprintWebrtcPolicy)
      return
    }
    updateField(key, next)
  }

  function renderField(key: FingerprintFieldKey): ReactNode {
    const meta = fingerprintFieldMeta[key]
    const id = `${idPrefix}-${key}`
    const error = errors[key]
    if (meta.control === "custom-resolution" && value.resolution !== "custom") return null

    if (meta.control === "noise") {
      return (
        <FieldShell key={key} label={meta.label} hint={meta.hint} error={error}>
          <div className="seg" role="group" aria-label={meta.label}>
            {fingerprintNoiseOptions.map((option) => (
              <NoiseButton
                key={option.value || "empty"}
                id={`${id}-${option.value || "empty"}`}
                label={option.label}
                selected={value[key] === option.value}
                onClick={() => updateField(key, option.value as FingerprintNoise)}
              />
            ))}
          </div>
        </FieldShell>
      )
    }

    if (meta.control === "spoofing") {
      return (
        <FieldShell key={key} label={meta.label} hint={meta.hint} error={error} wide>
          <div className="group" role="group" aria-label={meta.label}>
            {fingerprintSpoofingCategories.map((category) => (
              <label className="item" key={category.value}>
                <div className="main">
                  <div className="ttl">{category.label}</div>
                  <div className="desc mono">{category.value}</div>
                </div>
                <span className="check">
                  <input
                    id={`${id}-${category.value}`}
                    type="checkbox"
                    checked={(value.disableSpoofing ?? []).includes(category.value)}
                    onChange={(event) =>
                      updateField(
                        "disableSpoofing",
                        toggleSpoofing(
                          value.disableSpoofing ?? [],
                          category.value,
                          event.target.checked,
                        ),
                      )
                    }
                  />
                </span>
              </label>
            ))}
          </div>
        </FieldShell>
      )
    }

    if (meta.control === "args") {
      return (
        <FieldShell key={key} label={meta.label} hint={meta.hint} error={error} wide>
          <Textarea
            id={id}
            className={cn("mono", error ? "is-error" : "")}
            value={formatUnknownArgs(value.unknownArgs)}
            placeholder={meta.placeholder}
            onChange={(event) => updateField("unknownArgs", splitUnknownArgs(event.target.value))}
          />
        </FieldShell>
      )
    }

    if (meta.control === "select" || meta.control === "resolution") {
      const selectValue = selectFieldValue(value, key)
      return (
        <FieldShell key={key} label={meta.label} htmlFor={id} hint={meta.hint} error={error}>
          <select
            id={id}
            className={cn("input", meta.mono ? "mono" : "", error ? "is-error" : "")}
            value={selectValue}
            aria-invalid={error !== undefined}
            onChange={(event) => setSelectValue(selectKey(key), event.target.value)}
          >
            {(meta.options ?? []).map((option) => (
              <option value={option.value} key={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </FieldShell>
      )
    }

    if (isPlainTextField(key)) {
      return (
        <FieldShell key={key} label={meta.label} htmlFor={id} hint={meta.hint} error={error}>
          <Input
            id={id}
            className={cn(meta.mono ? "mono" : "", error ? "is-error" : "")}
            value={value[key] ?? ""}
            placeholder={meta.placeholder}
            aria-invalid={error !== undefined}
            onChange={(event) => setTextValue(key, event.target.value)}
          />
        </FieldShell>
      )
    }
    return null
  }

  return (
    <div className="fingerprint-form">
      <PresetSection
        title="快速生成"
        description="按 AntBrowser 常见画像一键填入品牌、平台、语言、时区和硬件；应用后保留当前种子。"
        presets={quickFingerprintPresets}
        idPrefix={idPrefix}
        value={value}
        onChange={onChange}
      />
      <PresetSection
        title="高级画像"
        description="带有伪装类别组合的画像，适合需要固定禁用项的账号。"
        presets={advancedFingerprintProfiles}
        idPrefix={idPrefix}
        value={value}
        onChange={onChange}
      />
      {fingerprintGroups.map((group) => (
        <section className="section" key={group.id} aria-label={group.title}>
          <div className="section-head">
            <h2>{group.title}</h2>
          </div>
          <p className="hint">{group.description}</p>
          <div className="lanes">{group.fields.map((key) => renderField(key))}</div>
        </section>
      ))}
    </div>
  )
}

function PresetSection({
  title,
  description,
  presets,
  idPrefix,
  value,
  onChange,
}: {
  title: string
  description: string
  presets: FingerprintPreset[]
  idPrefix: string
  value: ClaudeFingerprintView
  onChange: (value: ClaudeFingerprintView) => void
}) {
  return (
    <section className="section" aria-label={title}>
      <div className="section-head">
        <h2>{title}</h2>
        <span className="end">AntBrowser 1.8.0</span>
      </div>
      <p className="hint">{description}</p>
      <div className="lanes">
        {presets.map((preset) => (
          <Button
            key={preset.id}
            id={`${idPrefix}-preset-${preset.id}`}
            type="button"
            variant="plain"
            className="lane"
            onClick={() => onChange(applyFingerprintPreset(value, preset))}
          >
            <strong>{preset.name}</strong>
            <span>{preset.description}</span>
            <span className="mono">{preset.id}</span>
          </Button>
        ))}
      </div>
    </section>
  )
}

function FieldShell({
  label,
  htmlFor,
  hint,
  error,
  wide = false,
  children,
}: {
  label: string
  htmlFor?: string
  hint?: string
  error?: string
  wide?: boolean
  children: ReactNode
}) {
  return (
    <div className="field" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      {htmlFor === undefined ? (
        <div className="label">{label}</div>
      ) : (
        <label htmlFor={htmlFor}>{label}</label>
      )}
      {children}
      {hint === undefined ? null : <p className="hint">{hint}</p>}
      {error === undefined ? null : (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

function NoiseButton({
  id,
  label,
  selected,
  onClick,
}: {
  id: string
  label: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <Button
      id={id}
      type="button"
      variant="plain"
      className="seg-item"
      data-state={selected ? "on" : "off"}
      aria-pressed={selected}
      onClick={onClick}
    >
      {label}
    </Button>
  )
}

function toggleSpoofing(
  current: FingerprintSpoofingCategory[],
  category: FingerprintSpoofingCategory,
  checked: boolean,
): FingerprintSpoofingCategory[] {
  if (checked) return current.includes(category) ? current : [...current, category]
  return current.filter((item) => item !== category)
}

function isPlainTextField(key: FingerprintFieldKey): key is PlainTextFieldKey {
  return (
    key !== "webrtcPolicy" &&
    key !== "canvasNoise" &&
    key !== "clientRectsNoise" &&
    key !== "disableSpoofing" &&
    key !== "unknownArgs"
  )
}

function selectKey(key: FingerprintFieldKey): "brand" | "platform" | "webrtcPolicy" | "resolution" {
  if (key === "brand" || key === "platform" || key === "resolution") return key
  return "webrtcPolicy"
}

function selectFieldValue(value: ClaudeFingerprintView, key: FingerprintFieldKey): string {
  if (key === "brand") return value.brand
  if (key === "platform") return value.platform
  if (key === "resolution") return value.resolution ?? ""
  return value.webrtcPolicy ?? ""
}
