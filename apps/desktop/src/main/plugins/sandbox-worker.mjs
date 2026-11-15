// 独立 Worker 验证沙箱后加载模块，只在一次调用内通过专用端口提供授权的能力。
const capabilityGroups = [
  ["storage", "get", "set", "delete"],
  ["secrets", "get", "set", "delete"],
  ["workspace", "readText"],
  ["notifications", "show"],
  ["composer", "insert"],
]
const maximumPendingCapabilities = 32
const create = Object.create
const freeze = Object.freeze
const isArray = Array.isArray
const includes = Function.prototype.call.bind(Array.prototype.includes)
const NativePromise = Promise
const NativeError = Error

function capabilityApi(methods, request) {
  const api = create(null)
  if (isArray(methods)) {
    for (let index = 0; index < capabilityGroups.length; index++) {
      const group = capabilityGroups[index]
      const name = group[0]
      const namespace = create(null)
      let exposed = false
      for (let methodIndex = 1; methodIndex < group.length; methodIndex++) {
        const method = group[methodIndex]
        const qualified = name + "." + method
        if (!includes(methods, qualified)) continue
        namespace[method] = (...args) => request(qualified, args)
        exposed = true
      }
      if (exposed) api[name] = freeze(namespace)
    }
  }
  return freeze(api)
}

self.addEventListener(
  "message",
  async ({ data, ports }) => {
    const port = ports[0]
    if (!port) return
    const send = port.postMessage.bind(port)
    const parse = JSON.parse.bind(JSON)
    const stringify = JSON.stringify.bind(JSON)
    const pending = new Map()
    const getPending = pending.get.bind(pending)
    const setPending = pending.set.bind(pending)
    const deletePending = pending.delete.bind(pending)
    const clearPending = pending.clear.bind(pending)
    for (const name of ["WebSocket", "WebSocketStream", "WebTransport"]) {
      Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false })
    }
    if (
      typeof require !== "undefined" ||
      typeof process !== "undefined" ||
      typeof Deno !== "undefined" ||
      typeof Bun !== "undefined" ||
      typeof window !== "undefined" ||
      typeof RTCPeerConnection !== "undefined" ||
      typeof webkitRTCPeerConnection !== "undefined"
    ) {
      send({ type: "fatal", code: "PLUGIN_SANDBOX_UNAVAILABLE" })
      return
    }

    const { entry, limit } = data
    let invoke
    try {
      invoke = (await import(entry)).default
      if (typeof invoke !== "function") throw new NativeError()
    } catch {
      send({ type: "fatal", code: "PLUGIN_LOAD_FAILED" })
      return
    }

    let started = false
    let activeId
    let nextRequestId = 1
    let pendingCount = 0

    function requestCapability(id, method, args) {
      return new NativePromise((resolve, reject) => {
        if (activeId !== id || pendingCount >= maximumPendingCapabilities) {
          reject(new NativeError("PLUGIN_CAPABILITY_DENIED"))
          return
        }
        // JSON 序列化可能调用插件的 toJSON；进入前预占容量。
        pendingCount++
        let values
        try {
          const encoded = stringify(args)
          if (typeof encoded !== "string" || encoded.length > limit) throw new NativeError()
          values = parse(encoded)
          if (!isArray(values)) throw new NativeError()
        } catch {
          pendingCount--
          reject(new NativeError("PLUGIN_PAYLOAD_INVALID"))
          return
        }
        const requestId = nextRequestId++
        setPending(requestId, { resolve, reject })
        try {
          send({ type: "capability", id, requestId, method, args: values })
        } catch {
          deletePending(requestId)
          pendingCount--
          reject(new NativeError("PLUGIN_CAPABILITY_DENIED"))
        }
      })
    }

    async function run({ id, operation, payload, capabilities }) {
      activeId = id
      const api = capabilityApi(capabilities, (method, args) => requestCapability(id, method, args))
      let response
      try {
        const result = await invoke(operation, parse(payload), api)
        try {
          const encoded = stringify(result)
          if (typeof encoded !== "string" || encoded.length > limit) throw new NativeError()
          response = { type: "result", id, payload: encoded }
        } catch {
          response = { type: "failure", id, code: "PLUGIN_RESULT_INVALID" }
        }
      } catch {
        response = { type: "failure", id, code: "PLUGIN_EXECUTION_FAILED" }
      }
      activeId = undefined
      clearPending()
      send(response)
    }

    port.onmessage = ({ data: request }) => {
      if (!request || typeof request !== "object") return
      if (request.type === "invoke" && !started && typeof request.id === "string") {
        started = true
        void run(request)
      } else if (request.type === "capability-result" && activeId === request.id) {
        const waiter = getPending(request.requestId)
        if (!waiter) return
        deletePending(request.requestId)
        pendingCount--
        if (request.ok === true) waiter.resolve(request.value)
        else waiter.reject(new NativeError("PLUGIN_CAPABILITY_DENIED"))
      }
    }
    send({ type: "ready" })
  },
  { once: true },
)
