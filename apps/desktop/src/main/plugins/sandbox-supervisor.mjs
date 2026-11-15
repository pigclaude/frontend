// 沙箱页面管理 Worker 和专用消息端口，每次调用结束时先终止当前 Worker。
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

  function forwardCapability({ id, requestId, method, args }) {
    if (
      !current ||
      id !== current.id ||
      !Number.isSafeInteger(requestId) ||
      requestId <= current.lastRequestId ||
      !current.methods.has(method) ||
      !Array.isArray(args)
    )
      return
    current.lastRequestId = requestId
    current.pending.add(requestId)
    try {
      main.postMessage({ type: "capability", id, requestId, method, args })
    } catch {
      crash()
    }
  }

  function replyToCapability({ id, requestId, ok, value }) {
    if (
      !active?.ready ||
      !current ||
      current.id !== id ||
      typeof ok !== "boolean" ||
      (ok && value === undefined) ||
      !current.pending.delete(requestId)
    )
      return
    try {
      active.broker.postMessage(
        ok
          ? { type: "capability-result", id, requestId, ok, value }
          : { type: "capability-result", id, requestId, ok },
      )
    } catch {
      crash()
    }
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
