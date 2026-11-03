// 在临时合成页面检查 ClientRects 的普通元素、绝对定位豁免及显式偏移。

/** 比较可控矩形的读取结果；期望偏移由调用方独立提供，不假设噪声必然非零。 */
export function inspectClientRectsFingerprint(expected) {
  if (
    !expected ||
    typeof expected !== "object" ||
    Array.isArray(expected) ||
    Object.keys(expected).some((key) => key !== "offset") ||
    (Object.hasOwn(expected, "offset") &&
      (!expected.offset ||
        typeof expected.offset !== "object" ||
        Array.isArray(expected.offset) ||
        Object.keys(expected.offset).length !== 2 ||
        !Object.hasOwn(expected.offset, "x") ||
        !Object.hasOwn(expected.offset, "y") ||
        !Number.isFinite(expected.offset.x) ||
        !Number.isFinite(expected.offset.y) ||
        Math.abs(expected.offset.x) > 0.001 ||
        Math.abs(expected.offset.y) > 0.001))
  )
    throw new TypeError("ClientRects 探针期望无效")
  const empty = (status, cleanup) => ({
    status,
    cleanup,
    fixedRepeatStable: null,
    fixedListMatches: null,
    fixedOffsetMatches: null,
    absoluteRepeatStable: null,
    absoluteListMatches: null,
    absoluteOriginMatches: null,
    dimensionsMatch: null,
  })
  const doc = globalThis.document
  if (!doc || typeof doc.createElement !== "function" || !doc.documentElement)
    return empty("unavailable", null)
  let host,
    result = empty("error", true),
    cleanup = true
  try {
    host = doc.createElement("div")
    const child = doc.createElement("div")
    host.style.cssText =
      "position:fixed;left:0;top:0;width:40px;height:20px;margin:0;padding:0;border:0;" +
      "box-sizing:content-box;transform:none;zoom:1;visibility:hidden;pointer-events:none;"
    child.style.cssText =
      "position:absolute;left:0;top:0;width:40px;height:20px;margin:0;padding:0;border:0;" +
      "box-sizing:content-box;transform:none;zoom:1;"
    host.appendChild(child)
    doc.documentElement.appendChild(host)
    const read = (node) => {
      const first = node.getBoundingClientRect()
      const again = node.getBoundingClientRect()
      const list = node.getClientRects()
      const values = [first, again, list?.length === 1 ? list[0] : null]
      if (
        values.some(
          (rect) => !rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite),
        )
      )
        return null
      return values
    }
    const fixed = read(host)
    const absolute = read(child)
    if (!fixed || !absolute) {
      result = empty("invalid", true)
    } else {
      const same = (left, right) =>
        ["x", "y", "width", "height"].every((key) => left[key] === right[key])
      const origin = (rect) => rect.x === 0 && rect.y === 0
      result = {
        status: "ok",
        cleanup: true,
        fixedRepeatStable: same(fixed[0], fixed[1]),
        fixedListMatches: same(fixed[0], fixed[2]),
        fixedOffsetMatches: Object.hasOwn(expected, "offset")
          ? fixed[0].x === Math.fround(expected.offset.x) &&
            fixed[0].y === Math.fround(expected.offset.y)
          : null,
        absoluteRepeatStable: same(absolute[0], absolute[1]),
        absoluteListMatches: same(absolute[0], absolute[2]),
        absoluteOriginMatches: origin(absolute[0]),
        dimensionsMatch: [...fixed, ...absolute].every(
          (rect) => rect.width === 40 && rect.height === 20,
        ),
      }
    }
  } catch {
    result = empty("error", true)
  } finally {
    if (host) {
      try {
        host.remove()
      } catch {
        cleanup = false
      }
    }
  }
  return { ...result, cleanup }
}

/** 在已有 CDP 会话执行合成 ClientRects 探针，仅接受有限的三态比较结果。 */
export async function inspectClientRectsFingerprintViaCdp(cdp, sessionId, expected) {
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
    throw new TypeError("ClientRects 探针参数无效")
  let serialized
  try {
    serialized = JSON.stringify(expected)
  } catch {
    throw new TypeError("ClientRects 探针期望无效")
  }
  if (typeof serialized !== "string" || serialized.length > 4096)
    throw new TypeError("ClientRects 探针期望无效")
  const parsed = JSON.parse(serialized)
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(expected).length !== Object.keys(parsed).length ||
    Object.keys(expected).some((key) => !Object.hasOwn(parsed, key))
  )
    throw new TypeError("ClientRects 探针期望无效")
  let response
  try {
    response = await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(${inspectClientRectsFingerprint.toString()})(${serialized})`,
        returnByValue: true,
      },
      sessionId,
    )
  } catch {
    throw new Error("ClientRects 探针执行失败")
  }
  if (response?.exceptionDetails) throw new Error("ClientRects 探针执行失败")
  const value = response?.result?.value
  const checks = [
    "fixedRepeatStable",
    "fixedListMatches",
    "fixedOffsetMatches",
    "absoluteRepeatStable",
    "absoluteListMatches",
    "absoluteOriginMatches",
    "dimensionsMatch",
  ]
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== checks.length + 2 ||
    !["status", "cleanup", ...checks].every((key) => Object.hasOwn(value, key)) ||
    !["ok", "error", "invalid", "unavailable"].includes(value.status) ||
    (value.status === "unavailable"
      ? value.cleanup !== null
      : typeof value.cleanup !== "boolean") ||
    !checks.every((key) => {
      if (value.status !== "ok") return value[key] === null
      if (key === "fixedOffsetMatches" && !Object.hasOwn(parsed, "offset"))
        return value[key] === null
      return typeof value[key] === "boolean"
    })
  )
    throw new Error("ClientRects 探针返回格式无效")
  return value
}

/** 检查选中绝对定位元素的 Range 偏移；该路径不沿用元素的定位豁免。 */
export function inspectClientRangeFingerprint(expected) {
  if (
    !expected ||
    typeof expected !== "object" ||
    Array.isArray(expected) ||
    Object.keys(expected).some((key) => key !== "offset") ||
    (Object.hasOwn(expected, "offset") &&
      (!expected.offset ||
        typeof expected.offset !== "object" ||
        Array.isArray(expected.offset) ||
        Object.keys(expected.offset).length !== 2 ||
        !Object.hasOwn(expected.offset, "x") ||
        !Object.hasOwn(expected.offset, "y") ||
        !Number.isFinite(expected.offset.x) ||
        !Number.isFinite(expected.offset.y) ||
        Math.abs(expected.offset.x) > 0.001 ||
        Math.abs(expected.offset.y) > 0.001))
  )
    throw new TypeError("ClientRects Range 探针期望无效")
  const empty = (status, cleanup) => ({
    status,
    cleanup,
    boundingRepeatStable: null,
    listRepeatStable: null,
    originsAgree: null,
    boundingOffsetMatches: null,
    listOffsetMatches: null,
    geometryNonEmpty: null,
  })
  const doc = globalThis.document
  if (
    !doc ||
    typeof doc.createElement !== "function" ||
    typeof doc.createRange !== "function" ||
    !doc.documentElement
  )
    return empty("unavailable", null)
  let host,
    range,
    result = empty("error", true),
    cleanup = true
  try {
    host = doc.createElement("div")
    const child = doc.createElement("div")
    host.style.cssText =
      "position:fixed;left:0;top:0;width:40px;height:20px;margin:0;padding:0;border:0;" +
      "box-sizing:content-box;transform:none;zoom:1;visibility:hidden;pointer-events:none;"
    child.style.cssText =
      "position:absolute;left:0;top:0;width:40px;height:20px;margin:0;padding:0;border:0;" +
      "box-sizing:content-box;transform:none;zoom:1;"
    host.appendChild(child)
    doc.documentElement.appendChild(host)
    range = doc.createRange()
    range.selectNode(child)
    const first = range.getBoundingClientRect()
    const second = range.getBoundingClientRect()
    const list = range.getClientRects()
    const repeated = range.getClientRects()
    const values = [
      first,
      second,
      list?.length === 1 ? list[0] : null,
      repeated?.length === 1 ? repeated[0] : null,
    ]
    if (
      values.some(
        (rect) => !rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite),
      )
    ) {
      result = empty("invalid", true)
    } else {
      const same = (left, right) =>
        ["x", "y", "width", "height"].every((key) => left[key] === right[key])
      const atExpected = (rect) =>
        rect.x === Math.fround(expected.offset.x) && rect.y === Math.fround(expected.offset.y)
      result = {
        status: "ok",
        cleanup: true,
        boundingRepeatStable: same(first, second),
        listRepeatStable: same(list[0], repeated[0]),
        originsAgree: first.x === list[0].x && first.y === list[0].y,
        boundingOffsetMatches: Object.hasOwn(expected, "offset") ? atExpected(first) : null,
        listOffsetMatches: Object.hasOwn(expected, "offset") ? atExpected(list[0]) : null,
        geometryNonEmpty: values.every((rect) => rect.width > 0 && rect.height > 0),
      }
    }
  } catch {
    result = empty("error", true)
  } finally {
    if (range) {
      try {
        if (typeof range.detach === "function") range.detach()
      } catch {
        cleanup = false
      }
    }
    if (host) {
      try {
        host.remove()
      } catch {
        cleanup = false
      }
    }
  }
  return { ...result, cleanup }
}

/** 在已有 CDP 会话中执行 Range 合成探针，不创建浏览器或网络连接。 */
export async function inspectClientRangeFingerprintViaCdp(cdp, sessionId, expected) {
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
    throw new TypeError("ClientRects Range 探针参数无效")
  let serialized
  try {
    serialized = JSON.stringify(expected)
  } catch {
    throw new TypeError("ClientRects Range 探针期望无效")
  }
  if (typeof serialized !== "string" || serialized.length > 4096)
    throw new TypeError("ClientRects Range 探针期望无效")
  const parsed = JSON.parse(serialized)
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.keys(expected).length !== Object.keys(parsed).length ||
    Object.keys(expected).some((key) => !Object.hasOwn(parsed, key))
  )
    throw new TypeError("ClientRects Range 探针期望无效")
  let response
  try {
    response = await cdp.send(
      "Runtime.evaluate",
      {
        expression: `(${inspectClientRangeFingerprint.toString()})(${serialized})`,
        returnByValue: true,
      },
      sessionId,
    )
  } catch {
    throw new Error("ClientRects Range 探针执行失败")
  }
  if (response?.exceptionDetails) throw new Error("ClientRects Range 探针执行失败")
  const value = response?.result?.value
  const checks = [
    "boundingRepeatStable",
    "listRepeatStable",
    "originsAgree",
    "boundingOffsetMatches",
    "listOffsetMatches",
    "geometryNonEmpty",
  ]
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== checks.length + 2 ||
    !["status", "cleanup", ...checks].every((key) => Object.hasOwn(value, key)) ||
    !["ok", "error", "invalid", "unavailable"].includes(value.status) ||
    (value.status === "unavailable"
      ? value.cleanup !== null
      : typeof value.cleanup !== "boolean") ||
    !checks.every((key) => {
      if (value.status !== "ok") return value[key] === null
      if (
        ["boundingOffsetMatches", "listOffsetMatches"].includes(key) &&
        !Object.hasOwn(parsed, "offset")
      )
        return value[key] === null
      return typeof value[key] === "boolean"
    })
  )
    throw new Error("ClientRects Range 探针返回格式无效")
  return value
}
