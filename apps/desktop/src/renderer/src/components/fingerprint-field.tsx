// 负责指纹字段的 shadcn 控件与无障碍标签：每个字段输出设置页样式的一行，左边名称、提示和错误，右边控件。

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
import { Button } from "./ui/button"
import { Label } from "./ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Switch } from "./ui/switch"
import { Textarea } from "./ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group"
import { FingerprintChoice } from "./fingerprint-choice"

const defaultChoice = "__default__"
const wideControls = new Set<FingerprintEditableFieldKey>([
  "lang",
  "acceptLang",
  "timezone",
  "webrtcPolicy",
])

/**
 * 根据字段类型渲染一行设置；所有变更都返回完整指纹对象，不丢弃隐藏分组的草稿。
 * 停用特征伪装的提示由表单作为小组说明渲染，这里只用同一个 hint id 关联。
 */
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

    if (key === "unknownArgs") {
      const args = value.unknownArgs ?? []
      if (args.some((arg) => /[\r\n]/.test(arg))) {
        return (
          <div className="fp-argument-list">
            <p className="note">包含换行的参数按单项编辑，修改其他参数时会保留原样。</p>
            {args.map((arg, index) => (
              <div className="fp-argument-entry" key={index}>
                <Textarea
                  id={index === 0 ? id : `${id}-${index + 1}`}
                  aria-label={`原始参数 ${index + 1}`}
                  className="mono fp-arguments"
                  value={arg}
                  spellCheck={false}
                  {...a11y}
                  onChange={(event) => {
                    const next = event.target.value
                    update(
                      key,
                      args.map((item, position) => (position === index ? next : item)),
                    )
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`删除原始参数 ${index + 1}`}
                  onClick={() =>
                    update(
                      key,
                      args.filter((_item, position) => position !== index),
                    )
                  }
                >
                  删除
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="添加原始参数"
              onClick={() => update(key, [...args, ""])}
            >
              添加参数
            </Button>
          </div>
        )
      }
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

  const hint =
    meta.hint && key !== "disableSpoofing" ? (
      <p className="desc" id={`${id}-hint`}>
        {meta.hint}
      </p>
    ) : null
  const errorText = error ? (
    <p className="error-text" id={`${id}-error`} role="alert">
      {error}
    </p>
  ) : null

  if (key === "disableSpoofing") {
    return (
      <div className="fp-spoofing" role="group" aria-label={meta.label} {...a11y}>
        {errorText ? (
          <div className="item fp-row">
            <div className="main">{errorText}</div>
          </div>
        ) : null}
        {fingerprintSpoofingCategories.map((category) => (
          <div className="item fp-row fp-row-inline" key={category.value}>
            <div className="main">
              <Label htmlFor={`${id}-${category.value}`} className="ttl">
                {category.label}
              </Label>
            </div>
            <div className="trail">
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
          </div>
        ))}
      </div>
    )
  }

  const title =
    key === "canvasNoise" || key === "clientRectsNoise" ? (
      <span className="ttl">{meta.label}</span>
    ) : (
      <Label htmlFor={id} className="ttl">
        {meta.label}
      </Label>
    )

  if (key === "unknownArgs") {
    return (
      <>
        <div className="item fp-row">
          <div className="main">
            {title}
            {hint}
            {errorText}
          </div>
        </div>
        <div className="fp-args">{control()}</div>
      </>
    )
  }

  return (
    <div className="item fp-row">
      <div className="main">
        {title}
        {hint}
        {errorText}
      </div>
      <div className={cn("trail", wideControls.has(key) && "fp-control-wide")}>{control()}</div>
    </div>
  )
}
