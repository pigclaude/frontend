// 负责以假子进程验证 Ego 委托的门禁、控制通道和安全输出边界。
import { test, expect } from "@playwright/test"
import { EventEmitter } from "node:events"
import { PassThrough, Readable } from "node:stream"
import { runInNewContext } from "node:vm"
import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createEgoAuthorizationBridge } from "./phase1-ego-authorization"

const url =
  "https://pigclaude.com/authorize/fixture-id/approve?client_id=pigclaude-desktop&purpose=pigclaude-login&state=fixture%2Bstate"
function fixture(output = 'PIGCLAUDE_EGO_RESULT={"status":"ready-for-approval"}\n', code = 0) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true,
  })
  let input = ""
  child.stdin.on("data", (chunk: Buffer) => {
    input += chunk.toString()
  })
  const calls: unknown[][] = []
  const launch = ((...args: unknown[]) => {
    calls.push(args)
    queueMicrotask(() => {
      child.stdout.write(output)
      child.stderr.write("fixture-secret")
      child.emit("close", code)
    })
    return child as unknown as ChildProcessWithoutNullStreams
  }) as typeof spawn
  const bridge = createEgoAuthorizationBridge({
    launch,
    gate: () => {},
    environment: {
      PATH: "/bin",
      HOME: "/fixture",
      SECRET: "fixture-secret",
      PIGCLAUDE_TASK7_GATE: "PASS",
    },
  })
  return { bridge, calls, input: () => input, launch }
}
test("无真实 gate 时零 spawn", async () => {
  const fake = fixture()
  const bridge = createEgoAuthorizationBridge({ launch: fake.launch })
  const previous = process.env["PIGCLAUDE_TASK7_GATE"]
  delete process.env["PIGCLAUDE_TASK7_GATE"]
  try {
    await expect(bridge.open(url)).rejects.toThrow("Ego授权委托失败")
    expect(fake.calls).toHaveLength(0)
  } finally {
    if (previous !== undefined) process.env["PIGCLAUDE_TASK7_GATE"] = previous
  }
})
test("URL 仅经 stdin，固定命令、OS环境与有限结果", async () => {
  const fake = fixture()
  expect(await fake.bridge.open(url)).toBe("ready-for-approval")
  expect(fake.calls[0]?.[0]).toBe("ego-browser")
  expect(JSON.stringify(fake.calls)).not.toContain(url)
  expect(JSON.parse(fake.input())).toEqual({ operation: "open", url })
  expect((fake.calls[0]?.[2] as { env: unknown }).env).toEqual({ PATH: "/bin", HOME: "/fixture" })
})
test("拒绝非精确来源、路径与未知重复query且零spawn", async () => {
  for (const invalid of [
    url.replace("pigclaude.com", "evil.test"),
    url.replace("https:", "http:"),
    url + "#x",
    url + "&unknown=x",
    url + "&state=x",
    url.replace("/approve", "/approve/"),
    url.replace("https://", "https://user@"),
    url.replace("/fixture-id/", "/%66ixture-id/"),
  ]) {
    const fake = fixture()
    await expect(fake.bridge.open(invalid)).rejects.toThrow("Ego授权委托失败")
    expect(fake.calls).toHaveLength(0)
  }
})
test("子进程失败与恶意输出不回显", async () => {
  for (const [output, code] of [
    ["fixture-secret", 0],
    ['PIGCLAUDE_EGO_RESULT={"status":"fixture-secret"}', 0],
    ['PIGCLAUDE_EGO_RESULT={"status":"ready-for-approval","url":"fixture-secret"}', 0],
    [
      'PIGCLAUDE_EGO_RESULT={"status":"ready-for-approval"}\nPIGCLAUDE_EGO_RESULT={"status":"ready-for-approval"}',
      0,
    ],
    ["fixture-secret", 1],
    ["x".repeat(65537), 0],
  ] as const) {
    await expect(fixture(output, code).bridge.open(url)).rejects.toThrow(/^Ego授权委托失败$/)
  }
})
test("批准只发送有限 operation 与布尔替换字段", async () => {
  const fake = fixture('notice update\nPIGCLAUDE_EGO_RESULT={"status":"authorized"}\n')
  expect(await fake.bridge.approve({ replace: true })).toBe("authorized")
  expect(JSON.parse(fake.input())).toEqual({ operation: "approve", replace: true })
})

test("固定脚本仅点击核实的 loopback callback，登录和真人验证交回 root", async () => {
  const fake = fixture()
  await fake.bridge.open(url)
  const script = (fake.calls[0]?.[1] as string[])[2]
  for (const [snapshot, href, expected] of [
    ["确认授权", "http://127.0.0.1:43123/oauth/callback?code=fixture&state=fixture", "authorized"],
    ["确认授权", "https://evil.test/oauth/callback?code=fixture&state=fixture", "unavailable"],
    [
      "确认授权",
      "http://127.0.0.1:43123/oauth/callback?code=fixture&state=fixture&extra=x",
      "unavailable",
    ],
    ["登录", "", "login-required"],
    ["Verify you are human", "", "human-required"],
  ]) {
    const clicks: string[] = []
    const output: string[] = []
    let returned = false
    const page = {
      url: async () => (returned ? "http://127.0.0.1:43123/oauth/callback" : url),
      snapshot: async () => snapshot,
      click: async (selector: string) => {
        clicks.push(selector)
        if (selector.includes("返回桌面客户端")) returned = true
      },
      waitForSelector: async () => {},
      evaluate: async () => href,
    }
    await (runInNewContext(`(async () => {${script}})()`, {
      process: {
        stdin: Readable.from([
          Buffer.from(JSON.stringify({ operation: "approve", replace: true })),
        ]),
      },
      Buffer,
      URL,
      console: { log: (value: string) => output.push(value) },
      taskSpace: async (id: number) => {
        expect(id).toBe(18)
        return {
          ownership: "agent",
          page: (label: string) => {
            expect(label).toBe("p1")
            return page
          },
        }
      },
    }) as Promise<void>)
    expect(output).toEqual([`PIGCLAUDE_EGO_RESULT=${JSON.stringify({ status: expected })}`])
    expect(clicks.some((selector) => selector.includes("返回桌面客户端"))).toBe(
      expected === "authorized",
    )
    if (["login-required", "human-required"].includes(expected!)) expect(clicks).toEqual([])
  }
})
