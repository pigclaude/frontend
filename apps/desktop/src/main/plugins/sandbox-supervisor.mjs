// 沙箱页面只管理 Worker 与消息端口，遇到取消、超时或崩溃时终止 Worker。
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
  let worker
  let broker
  let current
  let expiry
  let started = false

  function stop() {
    clearTimeout(expiry)
    worker?.terminate()
    broker?.close()
    worker = undefined
    broker = undefined
    started = false
  }

  function crash() {
    stop()
    main.postMessage({ type: "fatal", code: "PLUGIN_SANDBOX_CRASHED" })
  }

  function start(entry, limit) {
    if (worker) return
    const link = new MessageChannel()
    worker = new Worker("/runtime/worker.mjs", { type: "module" })
    broker = link.port1
    broker.onmessage = ({ data }) => {
      if (!data || typeof data !== "object") return
      if (data.type === "ready" && !started) {
        started = true
        main.postMessage({ type: "ready" })
      } else if (data.type === "fatal") {
        stop()
        main.postMessage({
          type: "fatal",
          code: data.code === "PLUGIN_SANDBOX_UNAVAILABLE" ? data.code : "PLUGIN_LOAD_FAILED",
        })
      } else if (
        current &&
        data.id === current &&
        (data.type === "result" || data.type === "failure")
      ) {
        clearTimeout(expiry)
        current = undefined
        main.postMessage(data)
      }
    }
    broker.onmessageerror = crash
    worker.onerror = crash
    worker.onmessageerror = crash
    worker.postMessage({ entry, limit }, [link.port2])
  }

  main.onmessage = ({ data }) => {
    if (!data || typeof data !== "object") return
    if (data.type === "init") {
      try {
        start(data.entry, data.limit)
      } catch {
        crash()
      }
    } else if (data.type === "invoke" && started && broker && !current) {
      current = data.id
      expiry = setTimeout(() => {
        const id = current
        current = undefined
        stop()
        main.postMessage({ type: "failure", id, code: "PLUGIN_TIMEOUT" })
      }, data.timeout)
      broker.postMessage({ id: data.id, operation: data.operation, payload: data.payload })
    } else if (data.type === "cancel" && data.id === current) {
      current = undefined
      stop()
      main.postMessage({ type: "failure", id: data.id, code: "PLUGIN_CANCELLED" })
    } else if (data.type === "close") {
      stop()
      main.close()
    }
  }
}

window.addEventListener("message", attach)
