// 负责通过浏览器子进程的专用管道交换启动控制消息，不开放本机调试端口。

import type { ChildProcess } from "node:child_process"
import { Readable, Writable } from "node:stream"
import { StringDecoder } from "node:string_decoder"

type Message = Record<string, unknown>
type Pending = { resolve: (value: Message) => void; reject: (error: Error) => void }
type Watcher = {
  match: (message: Message) => boolean
  resolve: () => void
  reject: (error: Error) => void
}

/** 浏览器在授权页面启动期间退出。 */
export class BrowserProcessExitedError extends Error {
  /** 创建不包含授权地址或凭据的退出错误。 */
  constructor() {
    super("授权浏览器已关闭")
    this.name = "BrowserProcessExitedError"
  }
}

/** 只与本次启动的浏览器交换调试协议消息。 */
export class BrowserControlPipe {
  readonly #input: Writable
  readonly #output: Readable
  readonly #child: ChildProcess
  readonly #signal: AbortSignal
  readonly #decoder = new StringDecoder("utf8")
  readonly #pending = new Map<number, Pending>()
  readonly #watchers = new Set<Watcher>()
  readonly #failure: Promise<never>
  #rejectFailure: (error: Error) => void = () => undefined
  #nextId = 0
  #buffer = ""
  #failed = false
  #released = false
  #unavailable = false

  /** 绑定子进程的第 3、4 号管道；管道不可用时明确失败。 */
  constructor(child: ChildProcess, signal: AbortSignal) {
    if (hasExited(child)) throw new BrowserProcessExitedError()
    const input = child.stdio[3]
    const output = child.stdio[4]
    if (!(input instanceof Writable) || !(output instanceof Readable)) {
      throw new Error("浏览器控制管道不可用")
    }
    signal.throwIfAborted()
    this.#input = input
    this.#output = output
    this.#child = child
    this.#signal = signal
    this.#failure = new Promise((_resolve, reject) => {
      this.#rejectFailure = reject
    })
    void this.#failure.catch(() => undefined)
    input.on("error", this.#onError)
    output.on("error", this.#onError)
    output.on("end", this.#onEnd)
    output.on("data", this.#onData)
    child.once("exit", this.#onExit)
    signal.addEventListener("abort", this.#onAbort, { once: true })
  }

  /** 发送一条命令，并只返回与该命令匹配的响应。 */
  request(method: string, params: Message = {}, sessionId?: string): Promise<Message> {
    if (this.#failed || this.#released) return Promise.reject(new Error("浏览器控制管道不可用"))
    if (this.#signal.aborted) return Promise.reject(new Error("浏览器启动已取消"))
    const id = ++this.#nextId
    return new Promise<Message>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      if (!this.#unavailable) {
        const message = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })
        this.#input.write(`${message}\0`, "utf8", (error) => {
          if (error) this.#onError()
        })
      }
    })
  }

  /** 等待外部准备操作时，同样监听浏览器退出和管道故障。 */
  race<T>(task: Promise<T>): Promise<T> {
    return Promise.race([task, this.#failure])
  }

  /** 订阅启动期间的指定事件；取消订阅不会关闭浏览器。 */
  watch(match: (message: Message) => boolean): { promise: Promise<void>; cancel: () => void } {
    let watcher: Watcher | undefined
    const promise = new Promise<void>((resolve, reject) => {
      if (this.#failed || this.#released || this.#signal.aborted) {
        reject(new Error("浏览器控制管道不可用"))
        return
      }
      watcher = { match, resolve, reject }
      this.#watchers.add(watcher)
    })
    void promise.catch(() => undefined)
    return {
      promise,
      cancel: () => {
        if (watcher !== undefined && this.#watchers.delete(watcher)) watcher.resolve()
      },
    }
  }

  /** 完成启动后保留管道至浏览器退出，且不阻止应用进程正常退出。 */
  release(): void {
    this.#released = true
    this.#signal.removeEventListener("abort", this.#onAbort)
    unref(this.#input)
    unref(this.#output)
  }

  /** 启动失败时关闭本次管道并中止所有尚未完成的操作。 */
  close(): void {
    this.#fail()
    this.#signal.removeEventListener("abort", this.#onAbort)
    this.#child.off("exit", this.#onExit)
    this.#input.destroy()
    this.#output.destroy()
  }

  readonly #onData = (chunk: Buffer | string): void => {
    if (this.#failed || this.#released) return
    this.#buffer += typeof chunk === "string" ? chunk : this.#decoder.write(chunk)
    if (this.#buffer.length > 1_048_576) {
      this.#fail()
      return
    }
    let end = this.#buffer.indexOf("\0")
    while (end !== -1) {
      const text = this.#buffer.slice(0, end)
      this.#buffer = this.#buffer.slice(end + 1)
      try {
        const message: unknown = JSON.parse(text)
        if (!isRecord(message)) throw new Error("invalid message")
        this.#dispatch(message)
      } catch {
        this.#fail()
        return
      }
      end = this.#buffer.indexOf("\0")
    }
  }

  readonly #onError = (): void => this.#markUnavailable()
  readonly #onEnd = (): void => this.#markUnavailable()
  readonly #onExit = (): void => this.#fail(new BrowserProcessExitedError())
  readonly #onAbort = (): void => this.#fail()

  #markUnavailable(): void {
    if (hasExited(this.#child)) this.#fail(new BrowserProcessExitedError())
    else this.#unavailable = true
  }

  #dispatch(message: Message): void {
    if (typeof message["id"] === "number") {
      const pending = this.#pending.get(message["id"])
      if (pending === undefined) return
      this.#pending.delete(message["id"])
      const result = message["result"]
      if (message["error"] !== undefined || !isRecord(result)) {
        pending.reject(new Error("浏览器控制命令失败"))
      } else {
        pending.resolve(result)
      }
      return
    }
    for (const watcher of this.#watchers) {
      if (watcher.match(message)) {
        this.#watchers.delete(watcher)
        watcher.resolve()
      }
    }
  }

  #fail(error = new Error("浏览器控制管道已关闭")): void {
    if (this.#failed) return
    this.#failed = true
    this.#rejectFailure(error)
    for (const pending of this.#pending.values()) pending.reject(error)
    for (const watcher of this.#watchers) watcher.reject(error)
    this.#pending.clear()
    this.#watchers.clear()
  }
}

function hasExited(child: ChildProcess): boolean {
  return typeof child.exitCode === "number" || typeof child.signalCode === "string"
}

function isRecord(value: unknown): value is Message {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function unref(stream: Readable | Writable): void {
  const candidate = stream as Readable & { unref?: () => void }
  candidate.unref?.()
}
