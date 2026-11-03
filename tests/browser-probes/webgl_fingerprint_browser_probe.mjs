// 在真实浏览器页面中检查 WebGL 指纹查询是否保留原生扩展和错误边界。

// 有界排空错误队列；溢出后无法再可靠地把错误归因到后续操作。
function createErrorReader(gl) {
  let attributable = true
  return () => {
    const priorAttributable = attributable
    const values = []
    for (let index = 0; index < 16; ++index) {
      const value = gl.getError()
      if (value === gl.NO_ERROR) return { attributable: priorAttributable, values }
      values.push(value)
    }
    attributable = false
    return { attributable: false, values }
  }
}

// 未能确定完整队列时返回 null，避免把残留错误误记到后续测试。
function errorsMatch(batch, expected) {
  if (!batch.attributable) return null
  return (
    batch.values.length === expected.length &&
    batch.values.every((value, index) => value === expected[index])
  )
}

// 聚合三态结果；已知失败优先于未知。
function allChecks(values) {
  if (values.includes(false)) return false
  return values.includes(null) ? null : true
}

/** 检查 WebGL1 与 WebGL2 的合法性边界，只返回测试结果而不返回设备指纹。 */
export function inspectWebglFingerprintGuards() {
  const inspect = (kind) => {
    const gl = document.createElement("canvas").getContext(kind)
    if (!gl) return { available: false }
    const takeErrors = createErrorReader(gl)

    const invalid = (parameter) => {
      const value = gl.getParameter(parameter)
      const error = errorsMatch(takeErrors(), [gl.INVALID_ENUM])
      return error === null ? null : value === null && error
    }
    const result = {
      available: true,
      unknownParameterRejected: invalid(0xdead),
      debugVendorRequiresExtension: invalid(0x9245),
      anisotropyRequiresExtension: invalid(0x84ff),
      drawBuffersRequiresExtension: kind === "webgl" ? invalid(0x8824) : null,
      validTextureLimit: null,
      debugExtensionRequestErrorClear: null,
      anisotropyExtensionRequestErrorClear: null,
      drawBuffersExtensionRequestErrorClear: null,
      debugExtensionWorks: null,
      anisotropyExtensionWorks: null,
      drawBuffersExtensionWorks: null,
    }

    const textureLimit = gl.getParameter(gl.MAX_TEXTURE_SIZE)
    result.validTextureLimit = allChecks([
      errorsMatch(takeErrors(), []),
      Number.isSafeInteger(textureLimit) && textureLimit > 0,
    ])
    const debug = gl.getExtension("WEBGL_debug_renderer_info")
    const debugRequestErrorClear = errorsMatch(takeErrors(), [])
    result.debugExtensionRequestErrorClear = debugRequestErrorClear
    if (debug) {
      const vendor = gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
      const vendorErrorClear = errorsMatch(takeErrors(), [])
      const renderer = gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      const rendererErrorClear = errorsMatch(takeErrors(), [])
      result.debugExtensionWorks = allChecks([
        debugRequestErrorClear,
        vendorErrorClear,
        rendererErrorClear,
        typeof vendor === "string",
        typeof renderer === "string",
      ])
    }
    const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic")
    const anisotropyRequestErrorClear = errorsMatch(takeErrors(), [])
    result.anisotropyExtensionRequestErrorClear = anisotropyRequestErrorClear
    if (anisotropy) {
      const value = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT)
      result.anisotropyExtensionWorks = allChecks([
        anisotropyRequestErrorClear,
        errorsMatch(takeErrors(), []),
        Number.isFinite(value) && value >= 1,
      ])
    }
    if (kind === "webgl") {
      const drawBuffers = gl.getExtension("WEBGL_draw_buffers")
      const drawBuffersRequestErrorClear = errorsMatch(takeErrors(), [])
      result.drawBuffersExtensionRequestErrorClear = drawBuffersRequestErrorClear
      if (drawBuffers) {
        const value = gl.getParameter(drawBuffers.MAX_DRAW_BUFFERS_WEBGL)
        result.drawBuffersExtensionWorks = allChecks([
          drawBuffersRequestErrorClear,
          errorsMatch(takeErrors(), []),
          Number.isSafeInteger(value) && value > 0,
        ])
      }
    }
    return result
  }

  return { webgl1: inspect("webgl"), webgl2: inspect("webgl2") }
}

/** 在已设置固定指纹种子的页面核验读取边界，不返回像素或设备信息。 */
export function inspectWebglPixelReadback() {
  const inspect = (kind) => {
    const canvas = document.createElement("canvas")
    canvas.width = 16
    canvas.height = 16
    const gl = canvas.getContext(kind, { preserveDrawingBuffer: true })
    if (!gl) return { available: false }
    if (gl.drawingBufferWidth !== 16 || gl.drawingBufferHeight !== 16)
      return { available: true, drawingBufferMatches: false }
    const takeErrors = createErrorReader(gl)
    gl.clearColor(0.2, 0.3, 0.4, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.enable(gl.SCISSOR_TEST)
    gl.scissor(4, 0, 8, 16)
    gl.clearColor(0.6, 0.5, 0.4, 1)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.disable(gl.SCISSOR_TEST)
    const setupErrorsClear = errorsMatch(takeErrors(), [])

    const first = new Uint8Array(8 * 8 * 4).fill(0xa5)
    const second = new Uint8Array(first.length).fill(0x5a)
    gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, first)
    const firstErrorClear = errorsMatch(takeErrors(), [])
    gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, second)
    const secondErrorClear = errorsMatch(takeErrors(), [])
    const readErrorsClear = allChecks([firstErrorClear, secondErrorClear])
    const alphaWriteWitness =
      first.every((value, index) => index % 4 !== 3 || value === 255) &&
      second.every((value, index) => index % 4 !== 3 || value === 255)
    const result = {
      available: true,
      drawingBufferMatches: true,
      setupErrorsClear,
      readErrorsClear,
      alphaWriteWitness:
        setupErrorsClear === true && readErrorsClear === true ? alphaWriteWitness : null,
      repeatedReadStable:
        setupErrorsClear === true && readErrorsClear === true && alphaWriteWitness
          ? first.every((value, index) => value === second[index])
          : null,
      priorErrorPreserved: false,
      sameCodeDifferentSourcesPreserved: false,
      repeatedDriverErrorCoalesced: false,
      invalidReadPreserved: false,
      incompleteFramebufferError: null,
      incompleteFramebufferUnchanged: null,
      framebufferCleanupErrorClear: null,
      clippedReadErrorsClear: null,
      clippedAlphaWriteWitness: null,
      clippedUnwrittenBytesUnchanged: null,
      fullyClippedUnwrittenBytesUnchanged: null,
      packedReadErrorClear: null,
      packedAlphaWriteWitness: null,
      packedUnwrittenBytesUnchanged: null,
    }

    gl.enable(0xdead)
    gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, second)
    result.priorErrorPreserved = errorsMatch(takeErrors(), [gl.INVALID_ENUM])
    gl.lineWidth(0)
    gl.pixelStorei(gl.PACK_ALIGNMENT, 3)
    gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, second)
    result.sameCodeDifferentSourcesPreserved = errorsMatch(takeErrors(), [
      gl.INVALID_VALUE,
      gl.INVALID_VALUE,
    ])
    gl.lineWidth(0)
    gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, second)
    gl.lineWidth(0)
    result.repeatedDriverErrorCoalesced = errorsMatch(takeErrors(), [gl.INVALID_VALUE])
    const invalid = new Uint8Array(first.length).fill(0x93)
    gl.readPixels(0, 0, 8, 8, 0xdead, gl.UNSIGNED_BYTE, invalid)
    const invalidError = errorsMatch(takeErrors(), [gl.INVALID_ENUM])
    result.invalidReadPreserved =
      invalidError === null ? null : invalidError && invalid.every((value) => value === 0x93)

    const framebuffer = gl.createFramebuffer()
    result.framebufferCreated = framebuffer !== null
    result.framebufferCreationErrorClear = errorsMatch(takeErrors(), [])
    if (framebuffer) {
      try {
        if (result.framebufferCreationErrorClear === true) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
          const bindErrorClear = errorsMatch(takeErrors(), [])
          if (bindErrorClear === true) {
            const incomplete = Uint8Array.from(
              { length: first.length },
              (_, index) => 20 + (index % 180),
            )
            const before = incomplete.slice()
            gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, incomplete)
            result.incompleteFramebufferError = errorsMatch(takeErrors(), [
              gl.INVALID_FRAMEBUFFER_OPERATION,
            ])
            if (result.incompleteFramebufferError === true)
              result.incompleteFramebufferUnchanged = incomplete.every(
                (value, index) => value === before[index],
              )
          }
        }
      } finally {
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        } finally {
          gl.deleteFramebuffer(framebuffer)
          result.framebufferCleanupErrorClear = errorsMatch(takeErrors(), [])
        }
      }
    }

    const clipped = [
      [-4, 0],
      [12, 0],
      [0, -4],
      [0, 12],
      [32, 32],
    ].map(([x, y]) => {
      const target = Uint8Array.from({ length: first.length }, (_, index) => 20 + (index % 180))
      const before = target.slice()
      gl.readPixels(x, y, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, target)
      const errorClear = errorsMatch(takeErrors(), [])
      let insidePixels = 0
      const unchanged = target.every((value, index) => {
        const pixel = Math.floor(index / 4)
        const sourceX = x + (pixel % 8)
        const sourceY = y + Math.floor(pixel / 8)
        const inside = sourceX >= 0 && sourceX < 16 && sourceY >= 0 && sourceY < 16
        return inside || value === before[index]
      })
      const alphaWritten = target.every((value, index) => {
        if (index % 4 !== 3) return true
        const pixel = Math.floor(index / 4)
        const sourceX = x + (pixel % 8)
        const sourceY = y + Math.floor(pixel / 8)
        const inside = sourceX >= 0 && sourceX < 16 && sourceY >= 0 && sourceY < 16
        if (!inside) return true
        ++insidePixels
        return value === 255
      })
      return { errorClear, unchanged, insidePixels, alphaWritten }
    })
    result.clippedReadErrorsClear = allChecks(clipped.map(({ errorClear }) => errorClear))
    result.clippedAlphaWriteWitness =
      setupErrorsClear === true && result.clippedReadErrorsClear === true
        ? clipped.every(({ insidePixels, alphaWritten }) => insidePixels === 0 || alphaWritten)
        : null
    result.clippedUnwrittenBytesUnchanged =
      result.clippedReadErrorsClear && result.clippedAlphaWriteWitness
        ? clipped.every(({ unchanged }) => unchanged)
        : null
    const fullyClipped = clipped.filter(({ insidePixels }) => insidePixels === 0)
    result.fullyClippedUnwrittenBytesUnchanged =
      allChecks(fullyClipped.map(({ errorClear }) => errorClear)) === true
        ? fullyClipped.every(({ unchanged }) => unchanged)
        : null

    if (kind === "webgl2") {
      gl.pixelStorei(gl.PACK_ALIGNMENT, 4)
      gl.pixelStorei(gl.PACK_ROW_LENGTH, 12)
      gl.pixelStorei(gl.PACK_SKIP_ROWS, 1)
      gl.pixelStorei(gl.PACK_SKIP_PIXELS, 1)
      const packSetupErrorClear = errorsMatch(takeErrors(), [])
      const packed = new Uint8Array(450).fill(0x93)
      gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, packed, 5)
      const readErrorClear = errorsMatch(takeErrors(), [])
      const start = 5 + 48 + 4
      result.packedReadErrorClear = allChecks([packSetupErrorClear, readErrorClear])
      result.packedAlphaWriteWitness =
        setupErrorsClear === true && result.packedReadErrorClear === true
          ? Array.from({ length: 8 * 8 }, (_, pixel) => {
              const row = Math.floor(pixel / 8)
              const column = pixel % 8
              return packed[start + row * 48 + column * 4 + 3] === 255
            }).every(Boolean)
          : null
      result.packedUnwrittenBytesUnchanged =
        result.packedReadErrorClear && result.packedAlphaWriteWitness
          ? packed.every((value, index) => {
              const offset = index - start
              const isPixel = offset >= 0 && offset < 8 * 48 && offset % 48 < 8 * 4
              return isPixel || value === 0x93
            })
          : null
    }
    return result
  }

  return { webgl1: inspect("webgl"), webgl2: inspect("webgl2") }
}

/** 使用合成绘图比较 WebGL2 数组与 PBO；写入见证不等于完整传输证明。 */
export function inspectWebglPboReadback() {
  const canvas = document.createElement("canvas")
  canvas.width = 16
  canvas.height = 16
  const gl = canvas.getContext("webgl2", { preserveDrawingBuffer: true })
  if (!gl) return { available: false }
  if (gl.drawingBufferWidth !== 16 || gl.drawingBufferHeight !== 16)
    return { available: true, drawingBufferMatches: false }
  const takeErrors = createErrorReader(gl)

  gl.clearColor(0.2, 0.3, 0.4, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.enable(gl.SCISSOR_TEST)
  gl.scissor(4, 0, 8, 16)
  gl.clearColor(0.6, 0.5, 0.4, 1)
  gl.clear(gl.COLOR_BUFFER_BIT)
  gl.disable(gl.SCISSOR_TEST)
  const setupErrorClear = errorsMatch(takeErrors(), [])

  const direct = new Uint8Array(8 * 8 * 4).fill(0xa5)
  const repeatedDirect = new Uint8Array(direct.length).fill(0x5a)
  gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, direct)
  const directErrorClear = errorsMatch(takeErrors(), [])
  gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, repeatedDirect)
  const repeatedDirectErrorClear = errorsMatch(takeErrors(), [])

  const buffer = gl.createBuffer()
  const creationErrorClear = errorsMatch(takeErrors(), [])
  if (!buffer)
    return { available: true, drawingBufferMatches: true, bufferCreated: false, creationErrorClear }
  let bufferErrorClear
  let first
  let second
  let cleanupErrorClear
  try {
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer)
    gl.bufferData(gl.PIXEL_PACK_BUFFER, direct.length + 16, gl.STREAM_READ)
    bufferErrorClear = errorsMatch(takeErrors(), [])
    const readPbo = (sentinel) => {
      const pixels = new Uint8Array(direct.length).fill(sentinel)
      gl.bufferSubData(gl.PIXEL_PACK_BUFFER, 8, pixels)
      const initializeErrorClear = errorsMatch(takeErrors(), [])
      const initialized = new Uint8Array(direct.length).fill(sentinel ^ 0xff)
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 8, initialized)
      const initializeCopyErrorClear = errorsMatch(takeErrors(), [])
      const initializeWitness = initialized.every((value) => value === sentinel)
      gl.readPixels(0, 0, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, 8)
      const readErrorClear = errorsMatch(takeErrors(), [])
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 8, pixels)
      return {
        pixels,
        initializeErrorClear,
        initializeCopyErrorClear,
        initializeWitness,
        readErrorClear,
        copyErrorClear: errorsMatch(takeErrors(), []),
      }
    }
    first = readPbo(0x3c)
    second = readPbo(0xc3)
  } finally {
    try {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null)
    } finally {
      gl.deleteBuffer(buffer)
      cleanupErrorClear = errorsMatch(takeErrors(), [])
    }
  }
  const equal = (left, right) => left.every((value, index) => value === right[index])
  const alphaWitness = (pixels) => pixels.every((value, index) => index % 4 !== 3 || value === 255)
  const noErrors = allChecks([
    setupErrorClear,
    directErrorClear,
    repeatedDirectErrorClear,
    creationErrorClear,
    bufferErrorClear,
    first.initializeErrorClear,
    first.initializeCopyErrorClear,
    first.readErrorClear,
    first.copyErrorClear,
    second.initializeErrorClear,
    second.initializeCopyErrorClear,
    second.readErrorClear,
    second.copyErrorClear,
    cleanupErrorClear,
  ])
  const directWriteWitness = alphaWitness(direct) && alphaWitness(repeatedDirect)
  const pboWriteWitness = alphaWitness(first.pixels) && alphaWitness(second.pixels)
  const initializationWitness = first.initializeWitness && second.initializeWitness
  const comparable = noErrors && initializationWitness && directWriteWitness && pboWriteWitness
  return {
    available: true,
    drawingBufferMatches: true,
    bufferCreated: true,
    noErrors,
    initializationWitness: noErrors === true ? initializationWitness : null,
    directWriteWitness,
    pboWriteWitness,
    directStable: comparable ? equal(direct, repeatedDirect) : null,
    pboStable: comparable ? equal(first.pixels, second.pixels) : null,
    directEqualsPbo: comparable ? equal(direct, first.pixels) : null,
  }
}
