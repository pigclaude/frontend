// 核对合成离线音频场景的采样率和渲染结果；不连接音频设备或网络。

/** 比较两种 OfflineAudioContext 的采样率与渲染，支持独立提供精确期望。 */
export async function inspectOfflineAudioFingerprint(options) {
  const allowed = ["requestedRate", "expectedRate", "timeoutMs"]
  if (
    !options ||
    typeof options !== "object" ||
    Array.isArray(options) ||
    Object.keys(options).some((key) => !allowed.includes(key)) ||
    !Number.isFinite(options.requestedRate) ||
    options.requestedRate <= 0 ||
    options.requestedRate > 768000 ||
    (Object.hasOwn(options, "expectedRate") &&
      (!Number.isFinite(options.expectedRate) ||
        options.expectedRate <= 0 ||
        options.expectedRate > 768001 ||
        Math.fround(options.expectedRate) !== options.expectedRate)) ||
    (options.timeoutMs !== undefined &&
      (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 10 || options.timeoutMs > 10000))
  )
    throw new TypeError("离线音频探针期望无效")
  const timeoutMs = options.timeoutMs ?? 2000
  const hasExpectedRate = Object.hasOwn(options, "expectedRate")
  const frameCount = 128
  const empty = (status) => ({
    status,
    contextRateMatches: null,
    bufferRateMatches: null,
    bufferRateMatchesContext: null,
    frameCountMatches: null,
    channelCountMatches: null,
    samplesSilent: null,
  })
  if (typeof globalThis.OfflineAudioContext !== "function")
    return {
      available: false,
      positional: empty("unavailable"),
      dictionary: empty("unavailable"),
      contextRatesAgree: null,
    }

  // 只保留合成条件下的内部采样率，函数返回结果不包含原始值。
  async function run(kind) {
    let context
    try {
      context =
        kind === "positional"
          ? new globalThis.OfflineAudioContext(1, frameCount, options.requestedRate)
          : new globalThis.OfflineAudioContext({
              numberOfChannels: 1,
              length: frameCount,
              sampleRate: options.requestedRate,
            })
    } catch {
      return { result: empty("constructor-error"), contextRate: null }
    }
    let contextRate
    try {
      contextRate = context.sampleRate
      if (!Number.isFinite(contextRate)) return { result: empty("invalid"), contextRate: null }
    } catch {
      return { result: empty("invalid"), contextRate: null }
    }
    let timer
    const outcome = await Promise.race([
      Promise.resolve()
        .then(() => context.startRendering())
        .then(
          (buffer) => ({ status: "ok", buffer }),
          () => ({ status: "render-error" }),
        ),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({ status: "timeout" }), timeoutMs)
      }),
    ])
    clearTimeout(timer)
    if (outcome.status !== "ok") return { result: empty(outcome.status), contextRate: null }
    try {
      const buffer = outcome.buffer
      if (
        !buffer ||
        !Number.isFinite(buffer.sampleRate) ||
        !Number.isInteger(buffer.length) ||
        !Number.isInteger(buffer.numberOfChannels) ||
        typeof buffer.getChannelData !== "function"
      )
        return { result: empty("invalid"), contextRate: null }
      const samples = buffer.getChannelData(0)
      if (
        !ArrayBuffer.isView(samples) ||
        Object.prototype.toString.call(samples) !== "[object Float32Array]"
      )
        return { result: empty("invalid"), contextRate: null }
      return {
        result: {
          status: "ok",
          contextRateMatches: hasExpectedRate ? contextRate === options.expectedRate : null,
          bufferRateMatches: hasExpectedRate ? buffer.sampleRate === options.expectedRate : null,
          bufferRateMatchesContext: buffer.sampleRate === contextRate,
          frameCountMatches: buffer.length === frameCount && samples.length === frameCount,
          channelCountMatches: buffer.numberOfChannels === 1,
          samplesSilent: samples.every((value) => value === 0),
        },
        contextRate,
      }
    } catch {
      return { result: empty("invalid"), contextRate: null }
    }
  }

  const positional = await run("positional")
  const dictionary = await run("dictionary")
  return {
    available: true,
    positional: positional.result,
    dictionary: dictionary.result,
    contextRatesAgree:
      positional.result.status === "ok" && dictionary.result.status === "ok"
        ? positional.contextRate === dictionary.contextRate
        : null,
  }
}

/** 在已建立的合成 CDP 会话运行离线音频探针，并只接受有限结构的比较结果。 */
export async function inspectOfflineAudioFingerprintViaCdp(cdp, sessionId, options) {
  if (
    !cdp ||
    typeof cdp.send !== "function" ||
    typeof sessionId !== "string" ||
    !sessionId ||
    sessionId.length > 256
  )
    throw new TypeError("离线音频探针会话无效")
  if (!options || typeof options !== "object" || Array.isArray(options))
    throw new TypeError("离线音频探针期望无效")
  let serialized
  try {
    serialized = JSON.stringify(options)
  } catch {
    throw new TypeError("离线音频探针期望无效")
  }
  if (typeof serialized !== "string" || serialized.length > 4096)
    throw new TypeError("离线音频探针期望无效")
  const parsed = JSON.parse(serialized)
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(options).length !== Object.keys(parsed).length ||
    Object.keys(options).some((key) => !Object.hasOwn(parsed, key))
  )
    throw new TypeError("离线音频探针期望无效")
  const hasExpectedRate = Object.hasOwn(parsed, "expectedRate")
  let reply
  try {
    reply = await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(${inspectOfflineAudioFingerprint.toString()})(${serialized})`,
        awaitPromise: true,
        returnByValue: true,
      },
      sessionId,
    )
  } catch {
    throw new Error("离线音频探针执行失败")
  }
  if (reply?.exceptionDetails) throw new Error("离线音频探针执行失败")
  const value = reply?.result?.value
  const keys = (item, names) =>
    item !== null &&
    typeof item === "object" &&
    !Array.isArray(item) &&
    Object.keys(item).length === names.length &&
    names.every((name) => Object.hasOwn(item, name))
  const fields = [
    "contextRateMatches",
    "bufferRateMatches",
    "bufferRateMatchesContext",
    "frameCountMatches",
    "channelCountMatches",
    "samplesSilent",
  ]
  const statuses = ["ok", "unavailable", "constructor-error", "render-error", "timeout", "invalid"]
  const caseValid = (item) =>
    keys(item, ["status", ...fields]) &&
    statuses.includes(item.status) &&
    fields.every((name) => {
      if (item.status !== "ok") return item[name] === null
      if (["contextRateMatches", "bufferRateMatches"].includes(name) && !hasExpectedRate)
        return item[name] === null
      return typeof item[name] === "boolean"
    })
  if (
    !keys(value, ["available", "positional", "dictionary", "contextRatesAgree"]) ||
    typeof value.available !== "boolean" ||
    !caseValid(value.positional) ||
    !caseValid(value.dictionary) ||
    (value.available
      ? [value.positional.status, value.dictionary.status].includes("unavailable")
      : value.positional.status !== "unavailable" || value.dictionary.status !== "unavailable") ||
    (value.positional.status === "ok" && value.dictionary.status === "ok"
      ? typeof value.contextRatesAgree !== "boolean"
      : value.contextRatesAgree !== null)
  )
    throw new Error("离线音频探针返回格式无效")
  return value
}
