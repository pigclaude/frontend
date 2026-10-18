// 负责注入式验证码配置查询和一次性 token 门禁，不依赖任一应用的 API 包。
"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  isCaptchaConfig,
  type CaptchaAction,
  type CaptchaConfig,
} from "@pigclaude/contracts/captcha"

/** 由应用注入公开配置读取器，SDK 与共享 UI 不反向依赖 API。 */
export interface TurnstileCaptchaInput {
  loadConfig: () => Promise<CaptchaConfig>
  action: CaptchaAction
}

/** 管理配置失败重试、当前 action 和 token 单次消费，所有已发送尝试都会换新 challenge。 */
export function useTurnstileCaptcha({ loadConfig, action }: TurnstileCaptchaInput) {
  const [config, setConfig] = useState<CaptchaConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const [reload, setReload] = useState(0)
  const [verified, setVerified] = useState<{ action: CaptchaAction; nonce: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const token = useRef<string | null>(null)
  const currentNonce = useRef(0)
  const activeAction = useRef(action)
  const pending = useRef(false)
  activeAction.current = action

  const reset = useCallback(() => {
    token.current = null
    currentNonce.current += 1
    setVerified(null)
    setNonce(currentNonce.current)
  }, [])

  useEffect(() => {
    let active = true
    reset()
    setConfig(null)
    setError(null)
    void Promise.resolve()
      .then(loadConfig)
      .then(
        (value) => {
          if (!active) return
          if (isCaptchaConfig(value)) setConfig(value)
          else setError("验证码配置暂时无法加载，请重试")
        },
        () => {
          if (active) setError("验证码配置暂时无法加载，请重试")
        },
      )
    return () => {
      active = false
      token.current = null
    }
  }, [loadConfig, reload, reset])

  const retry = useCallback(() => {
    reset()
    setConfig(null)
    setError(null)
    setReload((value) => value + 1)
  }, [reset])
  const onVerified = useCallback(
    (value: string) => {
      if (nonce !== currentNonce.current || action !== activeAction.current || pending.current)
        return
      token.current = value || null
      setVerified(value ? { action, nonce } : null)
    },
    [action, nonce],
  )
  const onInvalidate = useCallback(() => {
    if (nonce !== currentNonce.current || action !== activeAction.current) return
    token.current = null
    setVerified(null)
  }, [action, nonce])

  const ready =
    !busy &&
    config !== null &&
    (!config.enabled || (verified?.action === action && verified.nonce === nonce))

  const run = useCallback(
    async <T>(request: (captchaToken: string | undefined) => Promise<T>): Promise<T> => {
      if (!ready || pending.current || (config?.enabled && !token.current))
        throw new Error("请先完成验证码验证")
      pending.current = true
      const captchaToken = config?.enabled ? (token.current ?? undefined) : undefined
      token.current = null
      setVerified(null)
      setBusy(true)
      try {
        return await request(captchaToken)
      } finally {
        reset()
        pending.current = false
        setBusy(false)
      }
    },
    [config, ready, reset],
  )

  return {
    ready,
    run,
    retry,
    field: { config, error, action, nonce, busy, onRetry: retry, onVerified, onInvalidate },
  }
}
