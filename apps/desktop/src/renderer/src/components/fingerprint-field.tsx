// 负责指纹字段的 shadcn 控件与无障碍标签：下拉、三态切换、兼容开关及文本输入。

import type { ReactNode } from "react"
import type {
  ClaudeFingerprintView,
  FingerprintNoise,
  FingerprintWebrtcPolicy,
} from "@pigclaude/contracts/claude-account"
import { cn } from "../lib/cn"
import { fingerprintChoices, isFingerprintChoiceField } from "../models/fingerprint-choices"
import {
  fingerprintFieldMeta,
  fingerprintNoiseOptions,
  fingerprintSpoofingCategories,
  formatUnknownArgs,
  splitUnknownArgs,
  type FingerprintEditableFieldKey,
  type FingerprintFormErrors,
} from "../models/fingerprint-form"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Switch } from "./ui/switch"
import { Textarea } from "./ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group"
import { FingerprintChoice } from "./fingerprint-choice"

const defaultChoice = "__default__"

/** 根据字段类型渲染控件；所有变更都返回完整指纹对象，不丢弃隐藏分组的草稿。 */
export function FingerprintField({
  fieldKey: key,
  value,
  errors,
  idPrefix,
  onChange,
}: {
  fieldKey: FingerprintEditableFieldKey
  value: ClaudeFingerprintView
  errors: FingerprintFormErrors
  idPrefix: string
  onChange: (value: ClaudeFingerprintView) => void
}) {
  const meta = fingerprintFieldMeta[key]
  const id = `${idPrefix}-${key}`
  const error = errors[key]
  const describedBy =
    [meta.hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") ||
    undefined
  const a11y = { "aria-invalid": Boolean(error), "aria-describedby": describedBy }

  function update<K extends FingerprintEditableFieldKey>(field: K, next: ClaudeFingerprintView[K]) {
    onChange({ ...value, [field]: next })
  }

  function control(): ReactNode {
    if (key === "canvasNoise" || key === "clientRectsNoise") {
      return (
        <ToggleGroup
          id={id}
          type="single"
          value={value[key] || defaultChoice}
          aria-label={meta.label}
          {...a11y}
          onValueChange={(next) => {
            if (next) update(key, next === defaultChoice ? "" : (next as FingerprintNoise))
          }}
        >
          {fingerprintNoiseOptions.map((option) => (
            <ToggleGroupItem
              key={option.value || "empty"}
              id={`${id}-${option.value || "empty"}`}
              value={option.value || defaultChoice}
            >
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      )
    }

    if (key === "disableSpoofing") {
      return (
        <div className="fp-switches" role="group" aria-label={meta.label} {...a11y}>
          {fingerprintSpoofingCategories.map((category) => (
            <div className="fp-switch-row" key={category.value}>
              <Label htmlFor={`${id}-${category.value}`}>{category.label}</Label>
              <Switch
                id={`${id}-${category.value}`}
                aria-label={`停用 ${category.label} 伪装`}
                checked={(value.disableSpoofing ?? []).includes(category.value)}
                onCheckedChange={(checked) => {
                  const current = value.disableSpoofing ?? []
                  update(
                    key,
                    checked
                      ? [...new Set([...current, category.value])]
                      : current.filter((item) => item !== category.value),
                  )
                }}
              />
            </div>
          ))}
        </div>
      )
    }

    if (key === "unknownArgs") {
      return (
        <Textarea
          id={id}
          className="mono fp-arguments"
          value={formatUnknownArgs(value.unknownArgs)}
          placeholder={meta.placeholder}
          spellCheck={false}
          {...a11y}
          onChange={(event) => update(key, splitUnknownArgs(event.target.value))}
        />
      )
    }

    if (key === "brand" || key === "platform" || key === "resolution" || key === "webrtcPolicy") {
      return (
        <Select
          value={value[key] || defaultChoice}
          onValueChange={(next) => {
            const selected = next === defaultChoice ? "" : next
            if (key === "webrtcPolicy") update(key, selected as FingerprintWebrtcPolicy)
            else update(key, selected)
          }}
        >
          <SelectTrigger id={id} {...a11y}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="fp-select-menu">
            {(key === "brand" || key === "platform") &&
            !(meta.options ?? []).some((option) => option.value === "") ? (
              <SelectItem value={defaultChoice}>跟随默认</SelectItem>
            ) : null}
            {(meta.options ?? []).map((option) => (
              <SelectItem key={option.value || defaultChoice} value={option.value || defaultChoice}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (isFingerprintChoiceField(key)) {
      return (
        <FingerprintChoice
          id={id}
          label={meta.label}
          value={value[key] ?? ""}
          options={fingerprintChoices(key, value)}
          defaultLabel={meta.defaultLabel ?? "跟随默认"}
          placeholder={meta.placeholder}
          numeric={key === "seed" || key === "hardwareConcurrency"}
          mono={meta.mono}
          generateSeed={key === "seed"}
          searchable={key === "lang" || key === "acceptLang" || key === "timezone"}
          invalid={Boolean(error)}
          describedBy={describedBy}
          onChange={(next) => update(key, next)}
        />
      )
    }

    return (
      <Input
        id={id}
        className={cn(meta.mono && "mono", error && "is-error")}
        value={value[key] ?? ""}
        placeholder={meta.placeholder}
        spellCheck={false}
        {...a11y}
        onChange={(event) => update(key, event.target.value)}
      />
    )
  }

  if (key === "customResolution" && value.resolution !== "custom") return null
  const wide = key === "disableSpoofing" || key === "unknownArgs"
  const grouped = key === "canvasNoise" || key === "clientRectsNoise" || key === "disableSpoofing"

  return (
    <div className={cn("fp-field", wide && "fp-field-wide")}>
      {grouped ? (
        <span className="ui-label">{meta.label}</span>
      ) : (
        <Label htmlFor={id}>{meta.label}</Label>
      )}
      {control()}
      {meta.hint ? (
        <p className="hint" id={`${id}-hint`}>
          {meta.hint}
        </p>
      ) : null}
      {error ? (
        <p className="error-text" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
