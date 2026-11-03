// 在合成浏览器会话中核对页面和 Worker 的 UA/客户端提示，只返回比较结果。

/**
 * 比较调用方提供的合成期望与页面、专用 Worker 的 UA/UA-CH。
 * 未请求、不可用或超时的项目返回 null；本函数不访问网络或返回原始指纹。
 */
export async function inspectUaFingerprint(expected) {
  const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value)
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value, key)
  const allowedHigh = [
    "architecture",
    "bitness",
    "model",
    "platformVersion",
    "uaFullVersion",
    "fullVersionList",
    "wow64",
  ]
  const allowedTop = [
    "userAgentIncludes",
    "userAgentExcludes",
    "platform",
    "lowEntropy",
    "highEntropy",
    "timeoutMs",
  ]
  const fail = () => {
    throw new TypeError("UA 指纹探针期望无效")
  }
  const stringList = (value) =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= 16 &&
    value.every((item) => typeof item === "string" && item.length > 0 && item.length <= 256)
  const expectedBrands = (value) => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 16) return false
    if (
      !value.every(
        (item) =>
          isRecord(item) &&
          typeof item.brand === "string" &&
          item.brand.length > 0 &&
          item.brand.length <= 256 &&
          typeof item.version === "string" &&
          item.version.length > 0 &&
          item.version.length <= 256,
      )
    )
      return false
    return (
      new Set(value.map((item) => JSON.stringify([item.brand, item.version]))).size === value.length
    )
  }
  if (!isRecord(expected) || Object.keys(expected).some((key) => !allowedTop.includes(key))) fail()
  for (const key of ["userAgentIncludes", "userAgentExcludes"]) {
    if (has(expected, key) && !stringList(expected[key])) fail()
  }
  if (has(expected, "platform") && typeof expected.platform !== "string") fail()
  if (has(expected, "lowEntropy")) {
    if (
      !isRecord(expected.lowEntropy) ||
      Object.keys(expected.lowEntropy).length === 0 ||
      Object.keys(expected.lowEntropy).some(
        (key) => !["platform", "mobile", "brands"].includes(key),
      )
    )
      fail()
    if (has(expected.lowEntropy, "platform") && typeof expected.lowEntropy.platform !== "string")
      fail()
    if (has(expected.lowEntropy, "mobile") && typeof expected.lowEntropy.mobile !== "boolean")
      fail()
    if (has(expected.lowEntropy, "brands") && !expectedBrands(expected.lowEntropy.brands)) fail()
  }
  if (has(expected, "highEntropy")) {
    if (
      !isRecord(expected.highEntropy) ||
      Object.keys(expected.highEntropy).length === 0 ||
      Object.keys(expected.highEntropy).some((key) => !allowedHigh.includes(key))
    )
      fail()
    for (const [key, value] of Object.entries(expected.highEntropy)) {
      if (
        key === "fullVersionList"
          ? !expectedBrands(value)
          : key === "wow64"
            ? typeof value !== "boolean"
            : typeof value !== "string"
      )
        fail()
    }
  }
  if (
    !["userAgentIncludes", "userAgentExcludes", "platform", "lowEntropy", "highEntropy"].some(
      (key) => has(expected, key),
    )
  )
    fail()
  const timeoutMs = has(expected, "timeoutMs") ? expected.timeoutMs : 2000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 10000) fail()
  const highKeys = has(expected, "highEntropy") ? Object.keys(expected.highEntropy) : []

  // 读取失败与类型不符分开，避免把缺失字段记为匹配。
  function captureField(get, type) {
    try {
      const value = get()
      if (value === undefined || value === null) return { status: "unavailable" }
      return typeof value === type ? { status: "ok", value } : { status: "invalid" }
    } catch {
      return { status: "error" }
    }
  }

  // 复制有限品牌列表，保留重复项；排序只用于忽略浏览器的 GREASE 排列顺序。
  function captureBrands(get) {
    try {
      const value = get()
      if (value === undefined || value === null) return { status: "unavailable" }
      if (!Array.isArray(value) || value.length > 32) return { status: "invalid" }
      const pairs = []
      for (const item of value) {
        if (!item || typeof item.brand !== "string" || typeof item.version !== "string")
          return { status: "invalid" }
        pairs.push([item.brand, item.version])
      }
      pairs.sort((a, b) =>
        a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1,
      )
      return { status: "ok", value: pairs }
    } catch {
      return { status: "error" }
    }
  }

  // 页面和 Worker 使用同一套读取过程，但不向调用方返回读取值。
  function captureLow(nav) {
    const userAgent = captureField(() => nav.userAgent, "string")
    const platform = captureField(() => nav.platform, "string")
    let data
    try {
      data = nav.userAgentData
    } catch {
      return { userAgent, platform, hints: { status: "error" } }
    }
    if (data === undefined || data === null)
      return { userAgent, platform, hints: { status: "unavailable" } }
    if (typeof data !== "object") return { userAgent, platform, hints: { status: "invalid" } }
    return {
      userAgent,
      platform,
      hints: {
        status: "ok",
        platform: captureField(() => data.platform, "string"),
        mobile: captureField(() => data.mobile, "boolean"),
        brands: captureBrands(() => data.brands),
      },
    }
  }

  // 仅请求调用方指定的高熵字段；异常不会暴露异常文本。
  async function captureHigh(nav, keys) {
    if (keys.length === 0) return { status: "not-requested" }
    try {
      const data = nav.userAgentData
      if (!data || typeof data.getHighEntropyValues !== "function") return { status: "unavailable" }
      const value = await data.getHighEntropyValues(keys)
      if (!value || typeof value !== "object") return { status: "invalid" }
      const fields = {}
      for (const key of keys) {
        fields[key] =
          key === "fullVersionList"
            ? captureBrands(() => value[key])
            : captureField(() => value[key], key === "wow64" ? "boolean" : "string")
      }
      return { status: "ok", fields }
    } catch {
      return { status: "error" }
    }
  }

  // 有界等待页面 API；即使底层 Promise 不完成也可返回未决状态。
  async function captureHighWithTimeout(nav, keys) {
    if (keys.length === 0) return { status: "not-requested" }
    let timer
    try {
      return await Promise.race([
        captureHigh(nav, keys),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }

  // Worker 只回传临时内存中的读取值；超时、创建异常及清理均有界处理。
  async function captureWorker(keys) {
    const urlApi = globalThis.URL
    if (
      typeof Worker !== "function" ||
      typeof Blob !== "function" ||
      typeof urlApi?.createObjectURL !== "function" ||
      typeof urlApi?.revokeObjectURL !== "function"
    )
      return { status: "unavailable", cleanup: null }
    const source =
      `const captureField = ${captureField.toString()};\n` +
      `const captureBrands = ${captureBrands.toString()};\n` +
      `const captureLow = ${captureLow.toString()};\n` +
      `const captureHigh = ${captureHigh.toString()};\n` +
      `self.onmessage = async (event) => {\n` +
      `  const low = captureLow(self.navigator);\n` +
      `  const high = await captureHigh(self.navigator, event.data);\n` +
      `  self.postMessage({low, high});\n` +
      `};\n`
    let url,
      worker,
      timer,
      outcome = { status: "error" },
      cleanup = true
    try {
      url = urlApi.createObjectURL(new Blob([source], { type: "text/javascript" }))
      worker = new Worker(url)
      outcome = await new Promise((resolve) => {
        let settled = false
        const finish = (value) => {
          if (settled) return
          settled = true
          resolve(value)
        }
        timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs)
        worker.onmessage = (event) => finish({ status: "ok", value: event.data })
        worker.onerror = (event) => {
          event?.preventDefault?.()
          finish({ status: "error" })
        }
        try {
          worker.postMessage(keys)
        } catch {
          finish({ status: "error" })
        }
      })
    } catch {
      outcome = { status: "error" }
    } finally {
      clearTimeout(timer)
      if (worker) {
        try {
          worker.terminate()
        } catch {
          cleanup = false
        }
      }
      if (url !== undefined) {
        try {
          urlApi.revokeObjectURL(url)
        } catch {
          cleanup = false
        }
      }
    }
    return { ...outcome, cleanup }
  }

  const fieldMatches = (actual, wanted) => {
    if (!actual || actual.status === "unavailable" || actual.status === "error") return null
    if (actual.status !== "ok") return false
    return actual.value === wanted
  }
  const brandSubsetMatches = (actual, wanted) => {
    if (!actual || actual.status === "unavailable" || actual.status === "error") return null
    if (actual.status !== "ok" || !Array.isArray(actual.value)) return false
    return wanted.every((item) =>
      actual.value.some(([brand, version]) => brand === item.brand && version === item.version),
    )
  }
  const fieldsEqual = (left, right) => {
    if (
      !left ||
      !right ||
      ["unavailable", "error"].includes(left.status) ||
      ["unavailable", "error"].includes(right.status)
    )
      return null
    if (left.status !== "ok" || right.status !== "ok") return false
    return JSON.stringify(left.value) === JSON.stringify(right.value)
  }

  const nav = globalThis.navigator
  const low = captureLow(nav)
  const [high, worker] = await Promise.all([
    captureHighWithTimeout(nav, highKeys),
    captureWorker(highKeys),
  ])
  const userAgentExpected =
    !has(expected, "userAgentIncludes") && !has(expected, "userAgentExcludes")
      ? null
      : low.userAgent.status === "ok"
        ? (expected.userAgentIncludes ?? []).every((part) => low.userAgent.value.includes(part)) &&
          (expected.userAgentExcludes ?? []).every((part) => !low.userAgent.value.includes(part))
        : low.userAgent.status === "invalid"
          ? false
          : null
  const hints = low.hints
  const lowExpected = expected.lowEntropy ?? {}
  const highExpected = expected.highEntropy ?? {}
  const highChecks = {}
  for (const key of highKeys) {
    const field = high.status === "ok" ? high.fields[key] : null
    highChecks[key] =
      key === "fullVersionList"
        ? brandSubsetMatches(field, highExpected[key])
        : fieldMatches(field, highExpected[key])
  }
  const isCapturedField = (value) =>
    isRecord(value) && ["ok", "unavailable", "error", "invalid"].includes(value.status)
  const isWorkerPayload = (value) => {
    if (!isRecord(value) || !isRecord(value.low) || !isRecord(value.high)) return false
    const lowValue = value.low
    const hintsValue = lowValue.hints
    if (
      !isCapturedField(lowValue.userAgent) ||
      !isCapturedField(lowValue.platform) ||
      !isRecord(hintsValue) ||
      !["ok", "unavailable", "error", "invalid"].includes(hintsValue.status)
    )
      return false
    if (
      hintsValue.status === "ok" &&
      !["platform", "mobile", "brands"].every((key) => isCapturedField(hintsValue[key]))
    )
      return false
    if (!["ok", "not-requested", "unavailable", "error", "invalid"].includes(value.high.status))
      return false
    return (
      value.high.status !== "ok" ||
      (isRecord(value.high.fields) &&
        highKeys.every((key) => isCapturedField(value.high.fields[key])))
    )
  }
  const workerData = worker.status === "ok" && isWorkerPayload(worker.value) ? worker.value : null
  const workerHints = workerData?.low?.hints
  const hintsAvailability =
    hints.status === "ok" && workerHints?.status === "ok"
      ? true
      : hints.status === "unavailable" && workerHints?.status === "unavailable"
        ? null
        : [hints.status, workerHints?.status].some(
              (status) => status === "error" || status === undefined,
            )
          ? null
          : false
  const highConsistency = {}
  for (const key of highKeys) {
    highConsistency[key] =
      high.status === "ok" && workerData?.high?.status === "ok"
        ? fieldsEqual(high.fields[key], workerData.high.fields?.[key])
        : null
  }
  return {
    page: {
      userAgentExpected,
      platformExpected: has(expected, "platform")
        ? fieldMatches(low.platform, expected.platform)
        : null,
      hintsStatus: hints.status,
      hintsAvailable: hints.status === "ok" ? true : hints.status === "unavailable" ? false : null,
      hintsPlatformExpected: has(lowExpected, "platform")
        ? fieldMatches(hints.platform, lowExpected.platform)
        : null,
      hintsMobileExpected: has(lowExpected, "mobile")
        ? fieldMatches(hints.mobile, lowExpected.mobile)
        : null,
      hintsBrandsExpected: has(lowExpected, "brands")
        ? brandSubsetMatches(hints.brands, lowExpected.brands)
        : null,
      highEntropyStatus: high.status,
      highEntropyExpected: highChecks,
    },
    worker: {
      status: worker.status === "ok" && !workerData ? "invalid" : worker.status,
      cleanup: worker.cleanup,
      userAgentMatchesPage: workerData
        ? fieldsEqual(low.userAgent, workerData.low.userAgent)
        : null,
      platformMatchesPage: workerData ? fieldsEqual(low.platform, workerData.low.platform) : null,
      hintsAvailabilityMatchesPage: hintsAvailability,
      hintsPlatformMatchesPage: fieldsEqual(hints.platform, workerHints?.platform),
      hintsMobileMatchesPage: fieldsEqual(hints.mobile, workerHints?.mobile),
      hintsBrandsMatchPage: fieldsEqual(hints.brands, workerHints?.brands),
      highEntropyStatus: workerData?.high?.status ?? null,
      highEntropyMatchesPage: highConsistency,
    },
  }
}
