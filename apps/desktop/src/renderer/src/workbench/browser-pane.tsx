// 将 Pigcode 浏览器工具栏接到独立原生浏览器，页面内容留在沙箱进程。
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { copyText, useLocale } from "@pigclaude/ui-primitives"
import { requestComposerContext } from "@pigclaude/ui-composer"
import { BrowserView, fitViewport, type BrowserViewport } from "@pigclaude/ui-workbench"
import type {
  AgentBrowserTab,
  WorkbenchBridge,
  WorkbenchBrowserPage,
} from "../../../workbench-contract"
import { useText } from "../locale/text"
import { workbenchError } from "./workbench-errors"

const blank: WorkbenchBrowserPage = {
  url: "",
  title: "",
  loading: false,
  canGoBack: false,
  canGoForward: false,
}

type Props = {
  bridge: WorkbenchBridge
  id: string
  initialUrl?: string | undefined
  agent?: AgentBrowserTab | undefined
  active: boolean
  onTitle: (title: string) => void
}

/** 显示一个浏览器标签，隐藏标签和应用弹层时移开原生视图。 */
export function BrowserPane({ bridge, id, initialUrl, agent, active, onTitle }: Props) {
  const { t } = useLocale()
  const { t: text } = useText()
  const sessionId = agent?.sessionId
  const scope = sessionId === undefined ? undefined : { id, sessionId }
  const [page, setPage] = useState(
    () => agent?.page ?? (initialUrl ? { ...blank, url: initialUrl } : blank),
  )
  const [viewport, setViewport] = useState<BrowserViewport | null>(null)
  const [scale, setScale] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const slot = useRef<HTMLDivElement>(null)
  const title = useRef(onTitle)
  title.current = onTitle
  const visible = useRef(active)
  visible.current = active

  useEffect(
    () =>
      bridge.subscribe((event) => {
        if (event.id !== id) return
        if (event.type === "browser-page" && event.sessionId === sessionId) {
          setPage(event.page)
          title.current(event.page.title || event.page.url || t("workbench.browser"))
        }
        if (event.type === "browser-context" && event.sessionId === sessionId && visible.current) {
          const { selector, text: content, url } = event.element
          requestComposerContext({
            id: `browser:${id}:${selector}`,
            label: text("workbench.browserContext"),
            title: selector,
            markdown: `${text("workbench.browserContext")}\nURL: ${url}\nSelector: ${selector}\nText: ${content}`,
          })
        }
      }),
    [bridge, id, sessionId, t, text],
  )

  useEffect(
    () => () => {
      if (sessionId === undefined) void bridge.browserClose(id).catch(() => undefined)
    },
    [bridge, id, sessionId],
  )

  const renderPage = active && page.url !== "" && !page.error && !page.crashed
  useLayoutEffect(() => {
    const element = slot.current
    if (!renderPage || !element) {
      void bridge.browserPresent(id, null, sessionId).catch(() => undefined)
      return
    }
    let frame = 0
    let previous = ""
    function measure() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (!element) return
        const rect = element.getBoundingClientRect()
        const overlay = document.querySelector(
          ".menu-positioner, [role='dialog'], .resize-overlay, .app.is-drawer-open",
        )
        const visible =
          rect.width > 0 && rect.height > 0 && !element.closest("[hidden]") && !overlay
        const fitted = viewport ? fitViewport(rect, viewport) : null
        if (fitted) setScale(fitted.scale)
        const bounds = visible
          ? {
              x: Math.max(0, Math.round(rect.left + (fitted?.x ?? 0))),
              y: Math.max(0, Math.round(rect.top + (fitted?.y ?? 0))),
              width: Math.max(1, Math.round(fitted?.width ?? rect.width)),
              height: Math.max(1, Math.round(fitted?.height ?? rect.height)),
              scale: Math.max(0.1, fitted?.scale ?? 1),
            }
          : null
        const key = JSON.stringify(bounds)
        if (key === previous) return
        previous = key
        void bridge.browserPresent(id, bounds, sessionId).catch(() => undefined)
      })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    const application = element.closest(".app")
    if (application) observer.observe(application)
    const mutations = new MutationObserver(measure)
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "style"],
    })
    window.addEventListener("resize", measure)
    measure()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      mutations.disconnect()
      window.removeEventListener("resize", measure)
      void bridge.browserPresent(id, null, sessionId).catch(() => undefined)
    }
  }, [bridge, id, sessionId, renderPage, viewport])

  function run(action: Promise<unknown>): void {
    setError(null)
    void action.catch((failure: unknown) => setError(workbenchError(failure, text)))
  }

  return (
    <>
      {error ? (
        <p className="workbench-error" role="alert">
          {error}
        </p>
      ) : null}
      <BrowserView
        page={page}
        viewport={viewport}
        viewportScale={scale}
        picking={picking}
        onNavigate={(url) => run(bridge.browserNavigate(id, url, sessionId))}
        onBack={() => run(bridge.browserCommand(id, "back", sessionId))}
        onForward={() => run(bridge.browserCommand(id, "forward", sessionId))}
        onReload={() => run(bridge.browserCommand(id, "reload", sessionId))}
        onStop={() => run(bridge.browserCommand(id, "stop", sessionId))}
        onViewportChange={setViewport}
        onOpenDevTools={() => run(bridge.browserCommand(id, "devtools", sessionId))}
        onOpenDefault={(url) => run(bridge.browserExternal(url, scope))}
        onCopyUrl={(url) => run(copyText(url))}
        onTogglePicker={() => {
          if (picking || !renderPage) return
          setPicking(true)
          void bridge
            .browserPick(id, sessionId)
            .catch((failure: unknown) => {
              setError(workbenchError(failure, text))
            })
            .finally(() => setPicking(false))
        }}
        openExternal={(url) => bridge.previewOpen(url, scope)}
        slot={<div className="browser-slot" ref={slot} />}
      />
    </>
  )
}
