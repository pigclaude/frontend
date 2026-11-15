// 沙箱页面管理 Worker 和专用消息端口，每次调用结束时先终止当前 Worker。
const maximumPendingCapabilities = 32
const utf8 = new TextEncoder()

function isBoundedJson(candidate, limit) {
  let remaining = limit
  function visit(value, depth) {
    remaining -= typeof value === "string" ? value.length + 2 : 1
    if (remaining < 0 || depth > 64) return false
    if (value === null || typeof value === "string" || typeof value === "boolean") return true
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return false
      remaining -= String(value).length - 1
      return remaining >= 0
    }
    if (Array.isArray(value)) {
      for (const item of value) if (!visit(item, depth + 1)) return false
      return true
    }
    if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      remaining -= key.length + 2
      if (!visit(value[key], depth + 1)) return false
    }
    return true
  }
  return visit(candidate, 0) && utf8.encode(JSON.stringify(candidate)).byteLength <= limit
}

function attach(event) {
  if (
    event.source !== window ||
    event.origin !== window.location.origin ||
    event.data !== "pigclaude-plugin-port"
  )
    return
  const main = event.ports[0]
  if (!main) return
  window.removeEventListener("message", attach)
  let configuration
  let active
  let current
  let expiry
  let acceptingCalls = false

  function retire() {
    clearTimeout(expiry)
    const retired = active
    active = undefined
    retired?.worker.terminate()
    retired?.broker.close()
  }

  function complete(response) {
    current = undefined
    // 主进程收到结果后可以立即给下一次调用分配网络权限。
    retire()
    main.postMessage(response)
  }

  function fatal(code) {
    acceptingCalls = false
    complete({ type: "fatal", code })
  }

  function crash() {
    fatal("PLUGIN_SANDBOX_CRASHED")
  }

  function sendCall(generation) {
    if (!current) return
    const { id, operation, payload, methods } = current
    try {
      generation.broker.postMessage({
        type: "invoke",
        id,
        operation,
        payload,
        capabilities: [...methods],
      })
    } catch {
      crash()
    }
  }

  function sendCapabilityReply(response) {
    try {
      active?.broker.postMessage(response)
    } catch {
      crash()
    }
  }

  function forwardCapability({ id, requestId, method, args }) {
    if (
      !active?.ready ||
      !current ||
      id !== current.id ||
      !Number.isSafeInteger(requestId) ||
      requestId <= current.lastRequestId
    )
      return
    current.lastRequestId = requestId
    if (
      current.pending.size >= maximumPendingCapabilities ||
      !current.methods.has(method) ||
      !Array.isArray(args) ||
      !isBoundedJson(args, configuration.limit)
    ) {
      sendCapabilityReply({ type: "capability-result", id, requestId, ok: false })
      return
    }
    current.pending.add(requestId)
    try {
      main.postMessage({ type: "capability", id, requestId, method, args })
    } catch {
      crash()
    }
  }

  function replyToCapability({ id, requestId, ok, value }) {
    if (!active?.ready || !current || current.id !== id || !current.pending.delete(requestId))
      return
    sendCapabilityReply(
      ok === true && isBoundedJson(value, configuration.limit)
        ? { type: "capability-result", id, requestId, ok: true, value }
        : { type: "capability-result", id, requestId, ok: false },
    )
  }

  function start() {
    const link = new MessageChannel()
    const worker = new Worker("/runtime/worker.mjs", { type: "module" })
    const broker = link.port1
    const generation = { worker, broker, ready: false }
    active = generation
    const onError = () => {
      if (active === generation) crash()
    }
    broker.onmessage = ({ data }) => {
      if (active !== generation || !data || typeof data !== "object") return
      if (data.type === "ready" && !generation.ready) {
        generation.ready = true
        if (!acceptingCalls) {
          acceptingCalls = true
          main.postMessage({ type: "ready" })
        }
        sendCall(generation)
      } else if (data.type === "capability") {
        forwardCapability(data)
      } else if (data.type === "fatal") {
        fatal(data.code === "PLUGIN_SANDBOX_UNAVAILABLE" ? data.code : "PLUGIN_LOAD_FAILED")
      } else if (
        current &&
        data.id === current.id &&
        (data.type === "result" || data.type === "failure")
      ) {
        complete(data)
      }
    }
    broker.onmessageerror = onError
    worker.onerror = onError
    worker.onmessageerror = onError
    worker.postMessage(configuration, [link.port2])
  }

  main.onmessage = ({ data }) => {
    if (!data || typeof data !== "object") return
    if (data.type === "init" && !configuration) {
      configuration = { entry: data.entry, limit: data.limit }
      try {
        start()
      } catch {
        crash()
      }
    } else if (
      data.type === "invoke" &&
      acceptingCalls &&
      !current &&
      typeof data.id === "string"
    ) {
      current = {
        id: data.id,
        operation: data.operation,
        payload: data.payload,
        methods: new Set(
          Array.isArray(data.capabilities)
            ? data.capabilities.filter((method) => typeof method === "string")
            : [],
        ),
        lastRequestId: 0,
        pending: new Set(),
      }
      expiry = setTimeout(() => {
        acceptingCalls = false
        complete({ type: "failure", id: data.id, code: "PLUGIN_TIMEOUT" })
      }, data.timeout)
      try {
        if (!active) start()
        else if (active.ready) sendCall(active)
      } catch {
        crash()
      }
    } else if (data.type === "capability-result") {
      replyToCapability(data)
    } else if (data.type === "cancel" && current && data.id === current.id) {
      acceptingCalls = false
      complete({ type: "failure", id: data.id, code: "PLUGIN_CANCELLED" })
    } else if (data.type === "close") {
      current = undefined
      retire()
      main.close()
    }
  }
}

window.addEventListener("message", attach)
