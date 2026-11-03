// 构造浏览器内的扩展状态检查，等待本次明确指定的扩展全部启用。

const readinessScript = String.raw`(expectedPaths, windows) => {
  const api = chrome.developerPrivate
  const normalize = (value) => {
    let path = windows ? value.replaceAll("\\", "/") : value
    if (windows && path.toLowerCase().startsWith("//?/unc/")) path = "//" + path.slice(8)
    else if (windows && path.startsWith("//?/")) path = path.slice(4)
    path = path.replace(/\/+$/, "")
    return windows ? path.toLowerCase() : path
  }
  const expected = expectedPaths.map(normalize)
  return new Promise((resolve, reject) => {
    let checking = false
    let pending = false
    let finished = false
    const check = async () => {
      if (finished) return
      if (checking) { pending = true; return }
      checking = true
      try {
        do {
          pending = false
          const list = await api.getExtensionsInfo({ includeDisabled: true, includeTerminated: true })
          if (!Array.isArray(list)) throw new Error("invalid extension list")
          const enabled = new Set(list.filter((item) => item.state === "ENABLED" && typeof item.path === "string").map((item) => normalize(item.path)))
          if (expected.every((path) => enabled.has(path))) {
            finished = true
            api.onItemStateChanged.removeListener(onChange)
            resolve(true)
            return
          }
        } while (pending)
      } catch (error) {
        finished = true
        api.onItemStateChanged.removeListener(onChange)
        reject(error)
      } finally {
        checking = false
      }
    }
    const onChange = () => { void check() }
    api.onItemStateChanged.addListener(onChange)
    void check()
  })
}`

/** 返回只报告就绪结果、不返回扩展内容的浏览器执行表达式。 */
export function extensionReadinessExpression(
  paths: readonly string[],
  platform: NodeJS.Platform,
): string {
  return `(${readinessScript})(${JSON.stringify(paths)}, ${platform === "win32"})`
}
