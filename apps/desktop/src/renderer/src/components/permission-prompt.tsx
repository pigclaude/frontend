// 负责权限询问卡片：参照 ZCode 的决定卡，把一次询问做成编号选项列表，正文按工具族展示终端命令、
// 文件改动、访问地址、搜索条件或计划正文，支持上下键、数字键和回车完成回答。卡片只消费会话状态。

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { FileText, Globe, Keyboard, Search } from "lucide-react"
import { MessageText, toolFamily, type ToolFamily } from "@pigclaude/ui-chat"
import { Button } from "@pigclaude/ui-primitives"
import { fill, useText, type TextKey } from "../locale/text"
import type { SessionPermissionCard } from "../models/session-permissions"
import type { BrowserPermissionContext } from "../../../browser-permission-contract"
import type { PermissionSuggestionSelection } from "../../../project-permissions-contract"
import { BrowserTypeDisclosure } from "./browser-type-disclosure"

/** 用户对一张权限卡的回答；只引用主进程给出的建议序号。 */
export type PermissionChoice = {
  decision: "allow" | "deny"
  suggestion?: PermissionSuggestionSelection
}

/** 选项 id；界面只用来生成稳定的列表键。 */
type PermissionOptionId =
  "allow-once" | `allow-session:${number}` | `allow-project:${number}` | "deny"

/** 一个可选的回答；label 是加粗标题，description 是下面一行说明。 */
export type PermissionOption = {
  id: PermissionOptionId
  label: string
  description: string
  choice: PermissionChoice
}

/** 正文里单独一行展示的目标：文件、地址或搜索条件。 */
export type PermissionTarget = {
  kind: "file" | "url" | "query"
  text: string
  /** 工作台浏览器网址中需要突出显示的来源。 */
  origin?: string
}

/** 一次写入：旧内容用于展示被替换或被删除的部分，新建文件时为空。 */
export type PermissionFileChange = {
  path: string
  removed: string | null
  added: string | null
}

type BrowserElement = Extract<BrowserPermissionContext, { kind: "click" | "type" }>

/** 卡片正文：一句话说明这次操作，再按工具族给出命令、目标、文件改动或计划正文。 */
export type PermissionDetail = {
  summary: string
  command: string | null
  target: PermissionTarget | null
  browserElement?: BrowserElement
  changes: PermissionFileChange[]
  blockedPath: string | null
  plan: string | null
}

/** 权限卡片的 props。 */
export type PermissionPromptProps = {
  request: SessionPermissionCard
  onDecide: (requestId: string, choice: PermissionChoice) => void
}

/** 预览里最多展开的行数；更长的内容在卡片里滚动查看完整长度。 */
const previewLines = 40

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function inputText(input: Record<string, unknown>, key: string): string | null {
  const value = input[key]
  return typeof value === "string" && value.trim() !== "" ? value : null
}

function countLines(text: string | null): number {
  if (text === null) return 0
  return text.split("\n").length
}

/** 给每行加前缀；超过预览行数时在末尾补一行省略号。 */
function prefixedLines(text: string, prefix: string): string {
  const lines = text.split("\n")
  const shown = lines.slice(0, previewLines).map((line) => `${prefix} ${line}`)
  if (lines.length > previewLines) shown.push("…")
  return shown.join("\n")
}

/** 计划模式下交出的计划正文；不是计划审批时返回 null。 */
function planText(request: SessionPermissionCard): string | null {
  if (request.toolName !== "ExitPlanMode") return null
  return inputText(request.input, "plan")
}

/** 写入类工具的文件改动：Write 看 content，Edit 看 old/new，MultiEdit 逐条展开。 */
function fileChanges(request: SessionPermissionCard): PermissionFileChange[] {
  const input = request.input
  const path = inputText(input, "file_path") ?? inputText(input, "notebook_path")
  if (path === null) return []
  const edits = Array.isArray(input.edits) ? input.edits : null
  if (edits !== null) {
    return edits.flatMap((edit) => {
      const record = asRecord(edit)
      if (record === null) return []
      return [
        {
          path,
          removed: inputText(record, "old_string"),
          added: inputText(record, "new_string"),
        },
      ]
    })
  }
  const content = inputText(input, "content")
  if (content !== null) return [{ path, removed: null, added: content }]
  const source = inputText(input, "new_source")
  if (source !== null) return [{ path, removed: null, added: source }]
  const removed = inputText(input, "old_string")
  const added = inputText(input, "new_string")
  if (removed === null && added === null) return []
  return [{ path, removed, added }]
}

/** 只读、访问与搜索类工具的目标行。 */
function permissionTarget(
  request: SessionPermissionCard,
  family: ToolFamily,
): PermissionTarget | null {
  const input = request.input
  if (family === "web-fetch" || family === "browser") {
    const url = inputText(input, "url") ?? inputText(input, "href")
    return url === null ? null : { kind: "url", text: url }
  }
  if (family === "search") {
    const query =
      inputText(input, "query") ?? inputText(input, "pattern") ?? inputText(input, "glob")
    const path = inputText(input, "path")
    if (query === null && path === null) return null
    if (query === null) return { kind: "query", text: path ?? "" }
    return { kind: "query", text: path === null ? query : `${query} · ${path}` }
  }
  if (family === "file-read") {
    const file =
      inputText(input, "file_path") ?? inputText(input, "path") ?? inputText(input, "notebook_path")
    return file === null ? null : { kind: "file", text: file }
  }
  return null
}

const browserSummary = {
  open: "permission.summary.browserOpen",
  snapshot: "permission.summary.browserSnapshot",
  click: "permission.summary.browserClick",
  type: "permission.summary.browserType",
  screenshot: "permission.summary.browserScreenshot",
} satisfies Record<Exclude<BrowserPermissionContext["kind"], "navigate">, TextKey>

const navigationSummary = {
  url: "permission.summary.browserNavigate",
  back: "permission.summary.browserBack",
  forward: "permission.summary.browserForward",
  reload: "permission.summary.browserReload",
} satisfies Record<Extract<BrowserPermissionContext, { kind: "navigate" }>["action"], TextKey>

/** 按工具族给出正文；计划看正文，终端看命令，写入看改动，只读与访问看目标。 */
export function permissionDetail(
  request: SessionPermissionCard,
  t: (key: TextKey) => string,
): PermissionDetail {
  if (request.plugin !== undefined) {
    const { name, id, toolName } = request.plugin
    return {
      summary: fill(t("permission.summary.plugin"), { plugin: `${name} (${id})`, tool: toolName }),
      command:
        Object.keys(request.input).length > 0 ? JSON.stringify(request.input, null, 2) : null,
      target: null,
      changes: [],
      blockedPath: null,
      plan: null,
    }
  }
  const { browser } = request
  if (browser !== undefined) {
    let target: PermissionTarget | null = null
    if ("url" in browser) {
      const { url } = browser
      const origin = URL.canParse(url) ? new URL(url).origin : ""
      target = { kind: "url", text: url, ...(origin && url.startsWith(origin) ? { origin } : {}) }
    }
    const summary = t(
      browser.kind === "navigate"
        ? navigationSummary[browser.action]
        : browserSummary[browser.kind],
    )
    return {
      summary:
        browser.kind === "screenshot"
          ? fill(summary, { width: String(browser.width), height: String(browser.height) })
          : summary,
      command: null,
      target,
      ...(browser.kind === "click" || browser.kind === "type" ? { browserElement: browser } : {}),
      changes: [],
      blockedPath: null,
      plan: null,
    }
  }
  const plan = planText(request)
  if (plan !== null) {
    return {
      summary: t("permission.plan.summary"),
      command: null,
      target: null,
      changes: [],
      blockedPath: null,
      plan,
    }
  }
  const family = toolFamily(request.toolName)
  const command =
    inputText(request.input, "command") ??
    inputText(request.input, "cmd") ??
    inputText(request.input, "command_line")
  const changes = family === "file-write" ? fileChanges(request) : []
  const target = changes.length > 0 ? null : permissionTarget(request, family)
  const summary =
    family === "shell"
      ? t("permission.summary.command")
      : family === "file-write"
        ? t("permission.summary.file")
        : family === "file-read"
          ? t("permission.summary.read")
          : family === "web-fetch"
            ? t("permission.summary.fetch")
            : family === "browser"
              ? t("permission.summary.browser")
              : family === "search"
                ? t("permission.summary.search")
                : fill(t("permission.summary.generic"), { tool: request.toolName })
  return { summary, command, target, changes, blockedPath: request.blockedPath, plan }
}

/** 组装编号选项；计划只需要开始或继续完善，“始终允许”只在 SDK 给出可写回的规则时出现。 */
export function permissionOptions(
  request: SessionPermissionCard,
  t: (key: TextKey) => string,
): PermissionOption[] {
  if (planText(request) !== null) {
    return [
      {
        id: "allow-once",
        label: t("permission.plan.start"),
        description: t("permission.plan.start.description"),
        choice: { decision: "allow" },
      },
      {
        id: "deny",
        label: t("permission.plan.keep"),
        description: t("permission.plan.keep.description"),
        choice: { decision: "deny" },
      },
    ]
  }
  const options: PermissionOption[] = [
    {
      id: "allow-once",
      label: t("permission.allowOnce"),
      description: t("permission.allowOnce.description"),
      choice: { decision: "allow" },
    },
  ]
  if (request.browser === undefined && request.suggestions.length !== 0) {
    const family = toolFamily(request.toolName)
    const label =
      family === "shell"
        ? t("permission.allowAlways.command")
        : family === "file-write"
          ? t("permission.allowAlways.file")
          : t("permission.allowAlways.generic")
    for (const { index, label: rule, canSaveProject, kind } of request.suggestions) {
      options.push({
        id: `allow-session:${index}`,
        label: kind === "directory" ? t("permission.allowDirectory.session") : label,
        description:
          kind === "directory"
            ? rule
            : [t("permission.allowAlways.description"), rule].filter(Boolean).join(" · "),
        choice: { decision: "allow", suggestion: { index, scope: "session" } },
      })
      if (canSaveProject)
        options.push({
          id: `allow-project:${index}`,
          label: t(
            kind === "directory" ? "permission.allowDirectory.project" : "permission.allowProject",
          ),
          description:
            kind === "directory"
              ? rule
              : [t("permission.allowProject.description"), rule].filter(Boolean).join(" · "),
          choice: { decision: "allow", suggestion: { index, scope: "project" } },
        })
    }
  }
  options.push({
    id: "deny",
    label: t("permission.deny"),
    description: t("permission.deny.description"),
    choice: { decision: "deny" },
  })
  return options
}

/** 目标行前面的图标；文件、地址与搜索各用一个。 */
function TargetIcon({ kind }: { kind: PermissionTarget["kind"] }) {
  if (kind === "url") return <Globe className="ic ic-xs" aria-hidden="true" />
  if (kind === "query") return <Search className="ic ic-xs" aria-hidden="true" />
  return <FileText className="ic ic-xs" aria-hidden="true" />
}

/** 绘制一张权限卡片；回答后由会话状态把卡片撤下。 */
export function PermissionPrompt({ request, onDecide }: PermissionPromptProps) {
  const { t } = useText()
  const detail = useMemo(() => permissionDetail(request, t), [request, t])
  const options = useMemo(() => permissionOptions(request, t), [request, t])
  const defaultIndex = request.defaultToNo ? options.length - 1 : 0
  const [selected, setSelected] = useState(defaultIndex)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const active = Math.min(selected, options.length - 1)
  const selectedOption = options[active]

  useEffect(() => {
    setSelected(defaultIndex)
    buttons.current[defaultIndex]?.focus()
  }, [defaultIndex, request.requestId])

  function choose(index: number): void {
    setSelected(index)
    buttons.current[index]?.focus()
  }

  function answer(option: PermissionOption): void {
    onDecide(request.requestId, option.choice)
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault()
      choose((index + 1) % options.length)
      return
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault()
      choose((index - 1 + options.length) % options.length)
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      const option = options[index]
      if (option !== undefined) answer(option)
      return
    }
    const digit = Number(event.key)
    if (!request.defaultToNo && Number.isInteger(digit) && digit >= 1 && digit <= options.length) {
      event.preventDefault()
      choose(digit - 1)
    }
  }

  return (
    <section className="perm-prompt" role="dialog" aria-label={t("permission.title")}>
      <header className="perm-prompt-head">
        <span className="perm-prompt-title">
          {detail.plan === null ? t("permission.title") : t("permission.plan.title")}
        </span>
        {detail.plan === null ? (
          <span className="perm-prompt-tool">{request.plugin?.toolName ?? request.toolName}</span>
        ) : null}
      </header>
      <div className="perm-prompt-body">
        <p className="perm-prompt-summary">{detail.summary}</p>
        {detail.plan === null ? null : (
          <div className="perm-prompt-plan">
            <MessageText text={detail.plan} />
          </div>
        )}
        {detail.target === null ? null : (
          <p className="perm-prompt-target">
            <TargetIcon kind={detail.target.kind} />
            <span>
              {detail.target.origin ? <strong>{detail.target.origin}</strong> : null}
              {detail.target.text.slice(detail.target.origin?.length ?? 0)}
            </span>
          </p>
        )}
        {detail.browserElement ? (
          <dl className="perm-browser-element">
            <dt>{t("permission.browser.elementRef")}</dt>
            <dd>{detail.browserElement.ref}</dd>
            <dt>{t("permission.browser.elementRole")}</dt>
            <dd>{detail.browserElement.role}</dd>
            <dt>{t("permission.browser.elementName")}</dt>
            <dd dir="auto">{detail.browserElement.name || t("permission.browser.unnamed")}</dd>
          </dl>
        ) : null}
        {request.browser?.kind === "type" ? (
          <BrowserTypeDisclosure
            key={request.requestId}
            context={request.browser}
            text={typeof request.input.text === "string" ? request.input.text : undefined}
          />
        ) : null}
        {detail.command === null ? null : <pre className="perm-prompt-code">{detail.command}</pre>}
        {detail.changes.map((change, index) => (
          <div className="perm-change" key={`${change.path}-${index}`}>
            <div className="perm-change-head">
              <FileText className="ic ic-xs" aria-hidden="true" />
              <span className="perm-change-path">{change.path}</span>
              <span className="perm-change-stat">
                {countLines(change.added) > 0 ? (
                  <span className="perm-change-add">+{countLines(change.added)}</span>
                ) : null}
                {countLines(change.removed) > 0 ? (
                  <span className="perm-change-del">−{countLines(change.removed)}</span>
                ) : null}
              </span>
            </div>
            {change.removed === null ? null : (
              <pre className="perm-change-removed">{prefixedLines(change.removed, "−")}</pre>
            )}
            {change.added === null ? null : (
              <pre className="perm-change-added">{prefixedLines(change.added, "+")}</pre>
            )}
          </div>
        ))}
        {detail.blockedPath === null || detail.blockedPath === detail.target?.text ? null : (
          <p className="perm-prompt-note">
            {fill(t("permission.blockedPath"), { path: detail.blockedPath })}
          </p>
        )}
      </div>
      <div className="perm-prompt-options" role="listbox" aria-label={t("permission.title")}>
        {options.map((option, index) => (
          <button
            key={option.id}
            ref={(node) => {
              buttons.current[index] = node
            }}
            type="button"
            role="option"
            aria-selected={index === active}
            tabIndex={index === active ? 0 : -1}
            className={index === active ? "perm-option is-active" : "perm-option"}
            onClick={() => (index === active ? answer(option) : choose(index))}
            onFocus={() => setSelected(index)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            <span className="perm-option-index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="perm-option-text">
              <span className="perm-option-label">{option.label}</span>
              <span className="perm-option-desc">{option.description}</span>
            </span>
          </button>
        ))}
      </div>
      <footer className="perm-prompt-foot">
        <span className="perm-prompt-hint">
          <Keyboard className="ic ic-xs" aria-hidden="true" />
          {t(request.defaultToNo ? "permission.keyboardHint.noDigits" : "permission.keyboardHint")}
        </span>
        <Button
          variant="primary"
          disabled={selectedOption === undefined}
          onClick={() => {
            if (selectedOption !== undefined) answer(selectedOption)
          }}
        >
          {t("permission.confirm")}
        </Button>
      </footer>
    </section>
  )
}
