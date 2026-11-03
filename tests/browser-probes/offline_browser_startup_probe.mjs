// 在调用方已核验的私有 CDP 页面中检查离线导航、DOM 和 JavaScript，不启动浏览器或联网。

/** 只在固定 data 文档中返回合成标记比较值，不回传页面内容或其他浏览器状态。 */
export function inspectOfflineStartupDocument(url, marker) {
  if (location.href !== url)
    return { ownDocument: false, ready: false, dom: false, javascript: false }
  const node = document.getElementById("pigclaude-startup")
  return {
    ownDocument: true,
    ready: document.readyState !== "loading",
    dom: node?.textContent === marker,
    javascript: node?.getAttribute("data-answer") === "42",
  }
}

/**
 * 验证已有私有页面会话的离线启动能力，不安装网络授权或修改代理。
 * 调用方负责先核验隐私边界、浏览器身份和页面独占；超时只停止等待，页面销毁由调用方负责。
 */
export async function inspectOfflineBrowserStartup(cdp, sessionId, marker, timeoutMs = 3000) {
  if (
    !cdp ||
    typeof cdp.send !== "function" ||
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    sessionId.length > 256 ||
    typeof marker !== "string" ||
    !/^[0-9a-f]{32}$/.test(marker) ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 10000
  )
    throw new TypeError("离线启动探针参数无效")

  const html =
    '<!doctype html><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" ' +
    "content=\"default-src 'none'; script-src 'unsafe-inline'\">" +
    `<p id="pigclaude-startup">${marker}</p>` +
    '<script>document.getElementById("pigclaude-startup").setAttribute("data-answer",' +
    "String(6 * 7))</script>"
  const url = "data:text/html;charset=utf-8," + encodeURIComponent(html)
  const expression =
    `(${inspectOfflineStartupDocument.toString()})` +
    `(${JSON.stringify(url)}, ${JSON.stringify(marker)})`
  let timer
  let waiting = true
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      waiting = false
      reject(new Error("离线启动探针超时；调用方仍须销毁私有页面"))
    }, timeoutMs)
  })
  const send = async (method, params) => {
    try {
      return await cdp.send(method, params, sessionId)
    } catch {
      throw new Error("离线启动 CDP 命令失败")
    }
  }
  const run = async () => {
    const navigation = await send("Page.navigate", { url })
    if (!waiting) return
    if (
      !navigation ||
      navigation.errorText ||
      typeof navigation.frameId !== "string" ||
      !navigation.frameId ||
      navigation.frameId.length > 256
    )
      throw new Error("离线启动导航失败")
    while (waiting) {
      let response
      try {
        response = await send("Runtime.evaluate", { expression, returnByValue: true })
      } catch {
        // 导航可销毁旧执行上下文；只在本轮截止时间内重试，不再导航或安装授权。
        if (!waiting) return
        await new Promise((resolve) => setTimeout(resolve, 20))
        continue
      }
      if (!waiting) return
      const value = response?.result?.value
      const keys = ["ownDocument", "ready", "dom", "javascript"]
      if (
        response?.exceptionDetails ||
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).length !== keys.length ||
        !keys.every((key) => Object.hasOwn(value, key) && typeof value[key] === "boolean")
      )
        throw new Error("离线启动探针结果无效")
      if (value.ownDocument && value.ready)
        return {
          ownDocument: value.ownDocument,
          dom: value.dom,
          javascript: value.javascript,
          offlinePageVerified: keys.every((key) => value[key]),
        }
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  try {
    return await Promise.race([run(), timeout])
  } finally {
    waiting = false
    clearTimeout(timer)
  }
}
