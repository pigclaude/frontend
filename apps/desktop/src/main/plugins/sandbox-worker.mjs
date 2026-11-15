// 独立 Worker 只通过专用端口收发 JSON；验证无特权接口后才导入预构建插件入口。
self.addEventListener(
  "message",
  async ({ data, ports }) => {
    const port = ports[0]
    if (!port) return
    const send = port.postMessage.bind(port)
    const parse = JSON.parse.bind(JSON)
    const stringify = JSON.stringify.bind(JSON)
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
      if (typeof invoke !== "function") throw new Error()
    } catch {
      send({ type: "fatal", code: "PLUGIN_LOAD_FAILED" })
      return
    }
    port.onmessage = async ({ data: request }) => {
      const { id, operation, payload } = request
      let result
      try {
        result = await invoke(operation, parse(payload))
      } catch {
        send({ type: "failure", id, code: "PLUGIN_EXECUTION_FAILED" })
        return
      }
      try {
        const encoded = stringify(result)
        if (typeof encoded !== "string" || encoded.length > limit) throw new Error()
        send({ type: "result", id, payload: encoded })
      } catch {
        send({ type: "failure", id, code: "PLUGIN_RESULT_INVALID" })
      }
    }
    send({ type: "ready" })
  },
  { once: true },
)
