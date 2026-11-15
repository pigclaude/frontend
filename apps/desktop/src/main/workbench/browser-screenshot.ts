// 在批准前读取页面尺寸，批准后截取同一 Agent 页面并限制 JPEG 的体积和像素尺寸。

import {
  type BrowserWindow,
  nativeImage,
  screen,
  type NativeImage,
  type WebContents,
  type WebContentsView,
} from "electron"
import type { BrowserPermissionContext } from "../../browser-permission-contract"
import { isAgentBrowserAddress } from "./agent-browser-network"

type Size = { width: number; height: number }
type Viewport = Size & { url: string; timeOrigin: number }

/** 截图审批和最终输出使用同一尺寸，像素读取只在执行时发生。 */
export type PreparedBrowserScreenshot = {
  context: Extract<BrowserPermissionContext, { kind: "screenshot" }>
  capture(signal?: AbortSignal): Promise<{ type: "image"; mimeType: "image/jpeg"; data: string }>
}

/** 可向模型返回的固定截图错误。 */
export class BrowserScreenshotError extends Error {
  /** 保留可读的固定英文原因。 */
  constructor(message: string) {
    super(message)
    this.name = "BrowserScreenshotError"
  }
}

const screenshotWorld = 1003
const loadingTimeoutMs = 10_000
const documentOriginScript = "performance.timeOrigin"
const changed = "The local page or viewport changed. Request a new screenshot approval."
const unavailable =
  "Couldn't capture this local page. Open or reload the Agent browser tab and try again."
const pendingCaptures = new WeakMap<WebContentsView, Promise<NativeImage>>()
const temporaryAttachments = new WeakMap<WebContentsView, BrowserWindow>()

/** 长边至多 1280 像素，总面积至多 120 万像素，按照原比例缩放。 */
export function boundedBrowserScreenshotSize({ width, height }: Size): Size {
  const factor = Math.min(
    1,
    1280 / Math.max(width, height),
    Math.sqrt(1_200_000 / (width * height)),
  )
  return {
    width: Math.max(1, Math.floor(width * factor)),
    height: Math.max(1, Math.floor(height * factor)),
  }
}

/** 用标签保留的原生尺寸和实际显示器倍率计算像素大小。 */
export function browserViewPixelSize(window: BrowserWindow, view: WebContentsView): Size {
  const { width, height } = view.getBounds()
  const scale = screen.getDisplayMatching(window.getBounds()).scaleFactor
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** 核对已有页的范围，执行时只取同一页裁剪后的 JPEG。 */
export async function prepareBrowserScreenshot(
  contents: WebContents,
  assertScope: () => void,
  readSize: () => Size,
  readPixels: (validate: () => Promise<void>, signal?: AbortSignal) => Promise<NativeImage>,
  signal?: AbortSignal,
): Promise<PreparedBrowserScreenshot> {
  assertScope()
  await waitForPage(contents, signal)
  const initial = await viewport(contents, assertScope, readSize)
  const size = boundedBrowserScreenshotSize(initial)
  return {
    context: { kind: "screenshot", url: initial.url, ...size },
    async capture(invocation = signal) {
      await waitForPage(contents, invocation)
      const validate = async () => {
        if (invocation?.aborted) throw new BrowserScreenshotError("The screenshot was cancelled.")
        assertSameViewport(initial, await viewport(contents, assertScope, readSize))
      }
      const image = await readPixels(validate, invocation)
      if (invocation?.aborted) throw new BrowserScreenshotError("The screenshot was cancelled.")
      assertSameViewport(initial, await viewport(contents, assertScope, readSize))
      return { type: "image", mimeType: "image/jpeg", data: encodeJpeg(image, size) }
    },
  }
}

/** 提升或关闭用户可见标签时，先解除正在捕获的隐藏挂载。 */
export function releaseBrowserCaptureView(view: WebContentsView): void {
  const owner = temporaryAttachments.get(view)
  temporaryAttachments.delete(view)
  if (owner && !owner.isDestroyed()) owner.contentView.removeChildView(view)
}

/** 已脱离的标签只在截取时暂挂到主窗口内容区之外，同一标签按批准顺序读取像素。 */
export async function captureBrowserView(
  owner: BrowserWindow,
  view: WebContentsView,
  attached: () => boolean,
  validate: () => Promise<void>,
  signal?: AbortSignal,
): Promise<NativeImage> {
  const previous = pendingCaptures.get(view)?.catch(() => undefined) ?? Promise.resolve()
  const work = previous.then(async () => {
    await validate()
    if (attached()) return captureWithTimeout(view.webContents, validate, signal)
    const bounds = view.getBounds()
    temporaryAttachments.set(view, owner)
    try {
      view.setBounds({ ...bounds, x: owner.getContentBounds().width, y: 0 })
      owner.contentView.addChildView(view)
      return await captureWithTimeout(view.webContents, validate, signal)
    } finally {
      if (temporaryAttachments.get(view) === owner) {
        releaseBrowserCaptureView(view)
        if (!attached() && !view.webContents.isDestroyed()) view.setBounds(bounds)
      }
    }
  })
  pendingCaptures.set(view, work)
  try {
    return await work
  } finally {
    if (pendingCaptures.get(view) === work) pendingCaptures.delete(view)
  }
}

async function captureWithTimeout(
  contents: WebContents,
  validate: () => Promise<void>,
  signal?: AbortSignal,
): Promise<NativeImage> {
  const deadline = AbortSignal.timeout(loadingTimeoutMs)
  const interrupted = signal ? AbortSignal.any([signal, deadline]) : deadline
  const failure = () =>
    new BrowserScreenshotError(signal?.aborted ? "The screenshot was cancelled." : unavailable)
  if (interrupted.aborted || contents.isDestroyed()) throw failure()
  let rejectCapture: (error: Error) => void = () => undefined
  const cancelled = new Promise<never>((_resolve, reject) => {
    rejectCapture = reject
  })
  const abort = () => rejectCapture(failure())
  interrupted.addEventListener("abort", abort, { once: true })
  contents.once("destroyed", abort)
  const previousThrottling = contents.backgroundThrottling
  try {
    contents.backgroundThrottling = false
    await Promise.race([
      contents.executeJavaScriptInIsolatedWorld(screenshotWorld, [
        {
          code: "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))",
        },
      ]),
      cancelled,
    ])
    await Promise.race([validate(), cancelled])
    return await Promise.race([
      contents.capturePage(undefined, { stayHidden: true, stayAwake: true }),
      cancelled,
    ])
  } finally {
    if (!contents.isDestroyed()) contents.backgroundThrottling = previousThrottling
    interrupted.removeEventListener("abort", abort)
    contents.removeListener("destroyed", abort)
  }
}

async function viewport(
  contents: WebContents,
  assertScope: () => void,
  readSize: () => Size,
): Promise<Viewport> {
  assertScope()
  const url = contents.getURL()
  if (!isAgentBrowserAddress(url)) throw new BrowserScreenshotError(unavailable)
  const timeOrigin: unknown = await contents.executeJavaScriptInIsolatedWorld(screenshotWorld, [
    { code: documentOriginScript },
  ])
  assertScope()
  if (contents.getURL() !== url || contents.isLoadingMainFrame())
    throw new BrowserScreenshotError(changed)
  const { width, height } = readSize()
  if (!positive(width) || !positive(height) || !positive(timeOrigin))
    throw new BrowserScreenshotError(unavailable)
  return {
    url,
    width,
    height,
    timeOrigin,
  }
}

function positive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
}

function assertSameViewport(initial: Viewport, next: Viewport): void {
  if (
    initial.url !== next.url ||
    initial.timeOrigin !== next.timeOrigin ||
    initial.width !== next.width ||
    initial.height !== next.height
  )
    throw new BrowserScreenshotError(changed)
}

function encodeJpeg(image: NativeImage, size: Size): string {
  if (image.isEmpty()) throw new BrowserScreenshotError(unavailable)
  const scaleFactor = Math.max(1, ...image.getScaleFactors())
  // 规范成单一像素倍率，确保多倍率显示器上的实际文件尺寸与审批一致。
  const pixels = nativeImage.createFromBuffer(image.toPNG({ scaleFactor }))
  if (pixels.isEmpty()) throw new BrowserScreenshotError(unavailable)
  const { width, height } = pixels.getSize()
  const error = Math.abs(width * size.height - height * size.width)
  if (error > Math.max(width, height) + Math.max(size.width, size.height))
    throw new BrowserScreenshotError(changed)
  const jpeg = pixels.resize({ ...size, quality: "best" }).toJPEG(70)
  if (jpeg.length === 0) throw new BrowserScreenshotError(unavailable)
  return jpeg.toString("base64")
}

function waitForPage(contents: WebContents, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(new BrowserScreenshotError("The screenshot was cancelled."))
  if (contents.isDestroyed()) return Promise.reject(new BrowserScreenshotError(unavailable))
  if (!contents.isLoading()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish("The local page is still loading. Try the screenshot again when it is ready."),
      loadingTimeoutMs,
    )
    const abort = () => finish("The screenshot was cancelled.")
    const closed = () => finish(unavailable)
    const loaded = () => {
      if (!contents.isLoading()) finish()
    }
    function finish(message?: string): void {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      contents.removeListener("destroyed", closed)
      contents.removeListener("render-process-gone", closed)
      contents.removeListener("did-stop-loading", loaded)
      if (message === undefined) resolve()
      else reject(new BrowserScreenshotError(message))
    }
    signal?.addEventListener("abort", abort, { once: true })
    contents.once("destroyed", closed)
    contents.once("render-process-gone", closed)
    contents.on("did-stop-loading", loaded)
    loaded()
  })
}
