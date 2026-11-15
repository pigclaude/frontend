// 用内存端口运行真实监督脚本，核对授权、UTF-8 上限和独立在途配额。

import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { expect, it, vi } from "vitest"

type Frame = Record<string, unknown>
type Attach = (event: { source: object; origin: string; data: string; ports: TestPort[] }) => void

const script = readFileSync(new URL("./sandbox-supervisor.mjs", import.meta.url), "utf8")

class TestPort {
  onmessage?: (event: { data: Frame }) => void
  postMessage = vi.fn<(data: Frame) => void>()
  close = vi.fn()

  receive(data: Frame): void {
    this.onmessage?.({ data })
  }
}

function supervisor(limit = 512 * 1024) {
  const id = "sample-call"
  const main = new TestPort()
  const worker = new TestPort()
  const attachments: Attach[] = []
  const window = {
    location: { origin: "sandbox:fixture" },
    addEventListener: (_type: string, receive: Attach) => attachments.push(receive),
    removeEventListener: vi.fn(),
  }
  runInNewContext(script, {
    window,
    Worker: class {
      postMessage = vi.fn()
      terminate = vi.fn()
    },
    MessageChannel: class {
      port1 = worker
      port2 = new TestPort()
    },
    TextEncoder,
    setTimeout: vi.fn(),
    clearTimeout: vi.fn(),
  })
  const [attach] = attachments
  if (!attach) throw new Error("监督页未安装端口入口")
  attach({
    source: window,
    origin: window.location.origin,
    data: "pigclaude-plugin-port",
    ports: [main],
  })
  main.receive({ type: "init", entry: "fixture.mjs", limit })
  worker.receive({ type: "ready" })
  main.receive({ type: "invoke", id, capabilities: ["notifications.show"] })
  main.postMessage.mockClear()
  worker.postMessage.mockClear()
  return {
    main,
    worker,
    request(requestId: number, args: readonly unknown[] = ["就绪"], method = "notifications.show") {
      worker.receive({ type: "capability", id, requestId, method, args })
    },
    response(requestId: number, fields: Frame) {
      main.receive({ type: "capability-result", id, requestId, ...fields })
    },
    denied(requestId: number) {
      return { type: "capability-result", id, requestId, ok: false }
    },
  }
}

it("监督脚本独立限制 32 项在途请求，回复后释放名额", () => {
  const fixture = supervisor()
  for (let id = 1; id <= 33; id++) fixture.request(id)

  expect(fixture.main.postMessage).toHaveBeenCalledTimes(32)
  expect(fixture.worker.postMessage).toHaveBeenCalledExactlyOnceWith(fixture.denied(33))

  fixture.response(1, { ok: true, value: "已送达" })
  fixture.request(34)
  expect(fixture.worker.postMessage).toHaveBeenLastCalledWith({
    ...fixture.denied(1),
    ok: true,
    value: "已送达",
  })
  expect(fixture.main.postMessage).toHaveBeenCalledTimes(33)
})

it("按 UTF-8 字节拒绝过大的参数和结果，并立即回复未授权或无效的请求", () => {
  const fixture = supervisor(32)
  fixture.request(1, ["界".repeat(10)])
  fixture.request(2, ["README.md"], "workspace.readText")
  fixture.request(3)
  fixture.response(3, { ok: true, value: "界".repeat(12) })
  fixture.request(4)
  fixture.response(4, { ok: true })

  expect(fixture.main.postMessage).toHaveBeenCalledTimes(2)
  expect(fixture.worker.postMessage.mock.calls).toEqual(
    [1, 2, 3, 4].map((id) => [fixture.denied(id)]),
  )
})
