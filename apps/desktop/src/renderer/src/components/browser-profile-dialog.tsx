// 编辑独立浏览器配置，按实际代理出口初始化语言/时区，避免账号向导保存第二份环境。

import { useEffect, useRef, useState } from "react"
import { defaultClaudeFingerprint, type ProxyView } from "@pigclaude/contracts/claude-account"
import type {
  BrowserProfileView,
  BrowserProfileRegion,
  SaveBrowserProfileInput,
} from "@pigclaude/contracts/browser-profile"
import { FingerprintForm } from "./fingerprint-form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import {
  prepareFingerprintSubmission,
  type FingerprintFormErrors,
} from "../models/fingerprint-form"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"

/** 只编辑共享配置，账号登录数据不进入此弹层。 */
export type BrowserProfileDialogProps = {
  profile: BrowserProfileView | null
  proxies: ProxyView[]
  onClose: () => void
  onSave: (input: SaveBrowserProfileInput) => Promise<void>
  onRegion: (proxyId: string) => Promise<BrowserProfileRegion>
}

/** 新建与编辑共用的完整指纹表单，异步地区建议取消后不会覆盖草稿。 */
export function BrowserProfileDialog({
  profile,
  proxies,
  onClose,
  onSave,
  onRegion,
}: BrowserProfileDialogProps) {
  const [name, setName] = useState(profile?.name ?? "")
  const [proxyId, setProxyId] = useState(profile?.proxyId ?? "")
  const [fingerprint, setFingerprint] = useState(profile?.fingerprint ?? defaultClaudeFingerprint())
  const [errors, setErrors] = useState<FingerprintFormErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [region, setRegion] = useState<BrowserProfileRegion | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  useEffect(
    () => () => {
      generation.current++
    },
    [],
  )

  async function initialize(id: string): Promise<void> {
    const request = ++generation.current
    setBusy(true)
    setError(null)
    try {
      const result = await onRegion(id)
      if (request !== generation.current) return
      setRegion(result)
      setFingerprint((current) => ({
        ...current,
        lang: result.locale,
        acceptLang: `${result.locale},${result.locale.split("-")[0]}`,
        timezone: result.timezone,
      }))
    } catch (caught: unknown) {
      if (request === generation.current) setError(errorMessage(caught))
    } finally {
      if (request === generation.current) setBusy(false)
    }
  }

  async function save(): Promise<void> {
    const prepared = prepareFingerprintSubmission(fingerprint)
    if (!prepared.ok) {
      setErrors(prepared.errors)
      return
    }
    if (!name.trim()) {
      setError("请填写浏览器配置名称")
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onSave({
        ...(profile ? { id: profile.id, revision: profile.revision } : {}),
        name: name.trim(),
        proxyId: proxyId || null,
        fingerprint: prepared.fingerprint,
      })
      onClose()
    } catch (caught: unknown) {
      setError(errorMessage(caught))
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="fingerprint-dialog">
        <div className="dialog-head">
          <DialogTitle>{profile ? `编辑「${profile.name}」` : "创建浏览器配置"}</DialogTitle>
          <DialogDescription>
            多个账号可复用配置，各账号的 Cookie、缓存和登录数据独立。语言和时区同时用于浏览器与
            CLI。
          </DialogDescription>
        </div>
        <div className="dialog-body">
          {profile?.boundAccounts.length ? (
            <p className="note">修改将影响 {profile.boundAccounts.length} 个账号的后续启动。</p>
          ) : null}
          <fieldset disabled={busy} className="browser-profile-fields">
            <div className="field">
              <label htmlFor="browser-profile-name">配置名称</label>
              <Input
                id="browser-profile-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="例如：美国工作环境"
              />
            </div>
            <div className="field">
              <label htmlFor="browser-profile-proxy">绑定代理</label>
              <Select
                disabled={busy}
                value={proxyId === "" ? systemNetwork : proxyId}
                onValueChange={(choice) => {
                  const next = choice === systemNetwork ? "" : choice
                  setProxyId(next)
                  setRegion(null)
                  if (next && !profile) void initialize(next)
                }}
              >
                <SelectTrigger id="browser-profile-proxy">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={systemNetwork}>不使用代理（系统网络）</SelectItem>
                  {proxyId && !proxies.some((proxy) => proxy.id === proxyId) ? (
                    <SelectItem value={proxyId}>原代理已不存在，请重新选择</SelectItem>
                  ) : null}
                  {proxies.map((proxy) => (
                    <SelectItem key={proxy.id} value={proxy.id}>
                      {proxy.name}
                      {proxy.lastTest?.ip ? ` · ${proxy.lastTest.ip}` : " · 未确认出口"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {proxyId ? (
              <Button variant="secondary" onClick={() => void initialize(proxyId)}>
                按代理出口初始化语言和时区
              </Button>
            ) : (
              <p className="note">
                未指定语言或时区时，保存会记录当前系统值，供浏览器与 CLI 共同使用。
              </p>
            )}
            {region ? (
              <p className="note">
                出口 {region.ip} · {region.countryCode} · {region.timezone}
                ；已应用地区语言建议，可手动调整。
              </p>
            ) : null}
            <FingerprintForm
              value={fingerprint}
              errors={errors}
              idPrefix="browser-profile"
              onChange={(value) => {
                setFingerprint(value)
                setErrors({})
              }}
            />
          </fieldset>
          {busy ? <p className="note">正在处理…</p> : null}
          {error ? (
            <p className="error-text" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dialog-foot">
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
            保存配置
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Radix Select 不接受空串取值；用这个不会与代理 id 冲突的标记表示「系统网络」。 */
const systemNetwork = "__system-network__"

function errorMessage(caught: unknown): string {
  return caught instanceof Error
    ? caught.message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, "")
    : "浏览器配置操作失败"
}
