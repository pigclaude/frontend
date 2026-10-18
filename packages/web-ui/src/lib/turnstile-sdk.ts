// 负责每个 document 的官方 Turnstile SDK 单次加载，并在加载失败后允许重试。
import type { CaptchaAction } from "@pigclaude/contracts/captcha"

/** explicit widget 只通过内存回调提供 token，不创建隐藏表单字段。 */
export interface TurnstileOptions {
  sitekey: string
  action: CaptchaAction
  theme: "light" | "dark"
  size: "flexible" | "compact"
  language: "zh-cn"
  "response-field": false
  retry: "never"
  "refresh-expired": "never"
  "refresh-timeout": "never"
  callback: (token: string) => void
  "expired-callback": () => void
  "error-callback": (code?: string) => void
  "timeout-callback": () => void
  "unsupported-callback": () => void
}

/** 仅声明本项目实际调用的供应商 SDK 能力。 */
export interface TurnstileSdk {
  /** 在指定节点渲染一个独立验证码实例。 */
  render(container: HTMLElement, options: TurnstileOptions): string | undefined
  /** 移除实例及其相关 DOM，换新实例时不会复用旧回调。 */
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileSdk
  }
}

const loads = new WeakMap<Document, Promise<TurnstileSdk>>()
const sdkUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

/** 并发调用共享同一次官方脚本加载；失败清理脚本和缓存，成功后不重复注入。 */
export function loadTurnstileSdk(doc: Document = document): Promise<TurnstileSdk> {
  const existing = loads.get(doc)
  if (existing) return existing
  if (doc.defaultView?.turnstile) return Promise.resolve(doc.defaultView.turnstile)
  const promise = new Promise<TurnstileSdk>((resolve, reject) => {
    const script = doc.createElement("script")
    script.src = sdkUrl
    script.async = true
    script.defer = true
    script.dataset.pigclaudeTurnstile = "true"
    const timer = setTimeout(fail, 15_000)

    function clear() {
      clearTimeout(timer)
      script.removeEventListener("load", loaded)
      script.removeEventListener("error", fail)
    }
    function fail() {
      clear()
      script.remove()
      loads.delete(doc)
      reject(new Error("验证码组件加载失败，请重试"))
    }
    function loaded() {
      const sdk = doc.defaultView?.turnstile
      if (!sdk || typeof sdk.render !== "function" || typeof sdk.remove !== "function") {
        fail()
        return
      }
      clear()
      resolve(sdk)
    }
    script.addEventListener("load", loaded)
    script.addEventListener("error", fail)
    doc.head.append(script)
  })
  loads.set(doc, promise)
  return promise
}
