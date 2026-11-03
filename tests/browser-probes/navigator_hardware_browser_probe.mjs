// 在合成页面和专用 Worker 中比较硬件并发数、设备内存及自动化标记。

/** 检查调用方指定的导航器期望，以及页面与专用 Worker 的同源字段是否一致。 */
export async function inspectNavigatorHardware(expected) {
  const allowed = ["hardwareConcurrency", "deviceMemory", "webdriver", "timeoutMs"]
  const has = (item, key) => Object.prototype.hasOwnProperty.call(item, key)
  if (
    !expected ||
    typeof expected !== "object" ||
    Array.isArray(expected) ||
    Object.keys(expected).some((key) => !allowed.includes(key)) ||
    !["hardwareConcurrency", "deviceMemory", "webdriver"].some((key) => has(expected, key)) ||
    (has(expected, "hardwareConcurrency") &&
      (!Number.isSafeInteger(expected.hardwareConcurrency) ||
        expected.hardwareConcurrency < 0 ||
        expected.hardwareConcurrency > 4294967295)) ||
    (has(expected, "deviceMemory") &&
      (!Number.isFinite(expected.deviceMemory) || expected.deviceMemory <= 0)) ||
    (has(expected, "webdriver") && typeof expected.webdriver !== "boolean") ||
    (has(expected, "timeoutMs") &&
      (!Number.isInteger(expected.timeoutMs) ||
        expected.timeoutMs < 10 ||
        expected.timeoutMs > 10000))
  )
    throw new TypeError("导航器硬件探针期望无效")
  const timeoutMs = expected.timeoutMs ?? 2000

  // 区分不存在、读取错误和类型错误；硬件并发数 0 不能被当作缺失。
  function capture(nav, key) {
    try {
      const value = nav?.[key]
      if (value === undefined || value === null) return { status: "unavailable" }
      const valid =
        key === "webdriver"
          ? typeof value === "boolean"
          : key === "hardwareConcurrency"
            ? Number.isSafeInteger(value) && value >= 0 && value <= 4294967295
            : Number.isFinite(value) && value > 0
      return valid ? { status: "ok", value } : { status: "invalid" }
    } catch {
      return { status: "error" }
    }
  }

  // Worker 只在页面内部回传临时值；超时也会终止 Worker 并释放 Blob URL。
  async function captureWorker() {
    const urlApi = globalThis.URL
    if (
      typeof Worker !== "function" ||
      typeof Blob !== "function" ||
      typeof urlApi?.createObjectURL !== "function" ||
      typeof urlApi?.revokeObjectURL !== "function"
    )
      return { status: "unavailable", cleanup: null }
    const source =
      `const capture = ${capture.toString()};\n` +
      `self.onmessage = () => self.postMessage({\n` +
      `  hardware: capture(self.navigator, "hardwareConcurrency"),\n` +
      `  memory: capture(self.navigator, "deviceMemory")\n` +
      `});\n`
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
          if (!settled) {
            settled = true
            resolve(value)
          }
        }
        timer = setTimeout(() => finish({ status: "timeout" }), timeoutMs)
        worker.onmessage = (event) => finish({ status: "ok", value: event.data })
        worker.onerror = (event) => {
          if (typeof event?.preventDefault === "function") event.preventDefault()
          finish({ status: "error" })
        }
        try {
          worker.postMessage(null)
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

  const validField = (field, key) => {
    if (!field || typeof field !== "object" || Array.isArray(field)) return false
    if (!["ok", "unavailable", "error", "invalid"].includes(field.status)) return false
    if (field.status !== "ok") return !has(field, "value")
    if (!has(field, "value")) return false
    return key === "hardware"
      ? Number.isSafeInteger(field.value) && field.value >= 0 && field.value <= 4294967295
      : Number.isFinite(field.value) && field.value > 0
  }
  const matches = (field, wanted, requested) => {
    if (!requested || ["unavailable", "error"].includes(field?.status) || !field) return null
    return field.status === "ok" ? field.value === wanted : false
  }
  const compare = (left, right) => {
    if (
      !left ||
      !right ||
      ["unavailable", "error"].includes(left.status) ||
      ["unavailable", "error"].includes(right.status)
    )
      return null
    return left.status === "ok" && right.status === "ok" && left.value === right.value
  }
  const nav = globalThis.navigator
  const hardware = capture(nav, "hardwareConcurrency")
  const memory = capture(nav, "deviceMemory")
  const webdriver = capture(nav, "webdriver")
  const worker = await captureWorker()
  const data =
    worker.status === "ok" &&
    worker.value &&
    typeof worker.value === "object" &&
    !Array.isArray(worker.value) &&
    validField(worker.value.hardware, "hardware") &&
    validField(worker.value.memory, "memory")
      ? worker.value
      : null
  return {
    page: {
      hardwareStatus: hardware.status,
      memoryStatus: memory.status,
      webdriverStatus: webdriver.status,
      hardwareExpected: matches(
        hardware,
        expected.hardwareConcurrency,
        has(expected, "hardwareConcurrency"),
      ),
      memoryExpected: matches(memory, expected.deviceMemory, has(expected, "deviceMemory")),
      webdriverExpected: matches(webdriver, expected.webdriver, has(expected, "webdriver")),
    },
    worker: {
      status: worker.status === "ok" && !data ? "invalid" : worker.status,
      cleanup: worker.cleanup,
      hardwareStatus: data?.hardware.status ?? null,
      memoryStatus: data?.memory.status ?? null,
      hardwareExpected: matches(
        data?.hardware,
        expected.hardwareConcurrency,
        has(expected, "hardwareConcurrency"),
      ),
      memoryExpected: matches(data?.memory, expected.deviceMemory, has(expected, "deviceMemory")),
      hardwareMatchesPage: compare(hardware, data?.hardware),
      memoryMatchesPage: compare(memory, data?.memory),
    },
  }
}

/** 在已有合成 CDP 会话执行导航器硬件探针，只允许返回三态比较结果。 */
export async function inspectNavigatorHardwareViaCdp(cdp, sessionId, expected) {
  if (
    !cdp ||
    typeof cdp.send !== "function" ||
    typeof sessionId !== "string" ||
    !sessionId ||
    sessionId.length > 256 ||
    !expected ||
    typeof expected !== "object" ||
    Array.isArray(expected)
  )
    throw new TypeError("导航器硬件探针参数无效")
  let serialized
  try {
    serialized = JSON.stringify(expected)
  } catch {
    throw new TypeError("导航器硬件探针期望无效")
  }
  if (typeof serialized !== "string" || serialized.length > 4096)
    throw new TypeError("导航器硬件探针期望无效")
  const parsed = JSON.parse(serialized)
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(expected).length !== Object.keys(parsed).length ||
    Object.keys(expected).some((key) => !Object.hasOwn(parsed, key))
  )
    throw new TypeError("导航器硬件探针期望无效")
  let response
  try {
    response = await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(${inspectNavigatorHardware.toString()})(${serialized})`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    )
  } catch {
    throw new Error("导航器硬件探针执行失败")
  }
  if (response?.exceptionDetails) throw new Error("导航器硬件探针执行失败")
  const value = response?.result?.value
  const keys = (item, names) =>
    item !== null &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    Object.keys(item).length === names.length &&
    names.every((name) => Object.hasOwn(item, name))
  const fieldStatuses = ["ok", "unavailable", "error", "invalid"]
  const workerStatuses = ["ok", "unavailable", "error", "invalid", "timeout"]
  const tri = (item) => item === null || typeof item === "boolean"
  const pageFields = ["hardwareExpected", "memoryExpected", "webdriverExpected"]
  const workerFields = [
    "hardwareExpected",
    "memoryExpected",
    "hardwareMatchesPage",
    "memoryMatchesPage",
  ]
  const page = value?.page
  const worker = value?.worker
  const expectedField = (status, result, requested) =>
    !requested || status === "unavailable" || status === "error"
      ? result === null
      : status === "invalid"
        ? result === false
        : typeof result === "boolean"
  const compareField = (left, right, result) =>
    ["unavailable", "error"].includes(left) || ["unavailable", "error"].includes(right)
      ? result === null
      : left === "invalid" || right === "invalid"
        ? result === false
        : typeof result === "boolean"
  if (
    !keys(value, ["page", "worker"]) ||
    !keys(page, ["hardwareStatus", "memoryStatus", "webdriverStatus", ...pageFields]) ||
    !keys(worker, ["status", "cleanup", "hardwareStatus", "memoryStatus", ...workerFields]) ||
    !fieldStatuses.includes(page.hardwareStatus) ||
    !fieldStatuses.includes(page.memoryStatus) ||
    !fieldStatuses.includes(page.webdriverStatus) ||
    !workerStatuses.includes(worker.status) ||
    !pageFields.every((name) => tri(page[name])) ||
    !workerFields.every((name) => tri(worker[name])) ||
    !expectedField(
      page.hardwareStatus,
      page.hardwareExpected,
      Object.hasOwn(parsed, "hardwareConcurrency"),
    ) ||
    !expectedField(page.memoryStatus, page.memoryExpected, Object.hasOwn(parsed, "deviceMemory")) ||
    !expectedField(
      page.webdriverStatus,
      page.webdriverExpected,
      Object.hasOwn(parsed, "webdriver"),
    ) ||
    (worker.status === "unavailable"
      ? worker.cleanup !== null
      : typeof worker.cleanup !== "boolean") ||
    (worker.status !== "ok"
      ? worker.hardwareStatus !== null ||
        worker.memoryStatus !== null ||
        !workerFields.every((name) => worker[name] === null)
      : !fieldStatuses.includes(worker.hardwareStatus) ||
        !fieldStatuses.includes(worker.memoryStatus) ||
        !expectedField(
          worker.hardwareStatus,
          worker.hardwareExpected,
          Object.hasOwn(parsed, "hardwareConcurrency"),
        ) ||
        !expectedField(
          worker.memoryStatus,
          worker.memoryExpected,
          Object.hasOwn(parsed, "deviceMemory"),
        ) ||
        !compareField(page.hardwareStatus, worker.hardwareStatus, worker.hardwareMatchesPage) ||
        !compareField(page.memoryStatus, worker.memoryStatus, worker.memoryMatchesPage))
  )
    throw new Error("导航器硬件探针返回格式无效")
  return value
}
