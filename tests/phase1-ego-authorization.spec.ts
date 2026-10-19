// 负责以假子进程验证 Ego 委托的门禁、控制通道和安全输出边界。
import { test, expect } from "@playwright/test"
import { EventEmitter } from "node:events"
import { PassThrough, Readable } from "node:stream"
import { runInNewContext } from "node:vm"
import type { ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { createEgoAuthorizationBridge } from "./phase1-ego-authorization"

const url =
  "https://pigclaude.com/authorize/fixture-id/approve?client_id=pigclaude-desktop&purpose=pigclaude-login&state=fixture%2Bstate"
function fixture(
  output = 'PIGCLAUDE_EGO_RESULT={"status":"ready-for-approval"}\n',
  code = 0,
  stderr = "",
) {
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
      child.stderr.write(stderr)
      child.emit("close", code)
    })
    return child as unknown as ChildProcessWithoutNullStreams
  }) as unknown as typeof spawn
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
  expect(runInNewContext(fake.input().split("\n")[0] + "\n input")).toEqual({
    operation: "open",
    url,
  })
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
  const fake = fixture('PIGCLAUDE_EGO_RESULT={"status":"authorized"}\n')
  expect(await fake.bridge.approve({ replace: true })).toBe("authorized")
  expect(runInNewContext(fake.input().split("\n")[0] + "\n input")).toEqual({
    operation: "approve",
    replace: true,
  })
})

test("固定脚本仅点击核实的 loopback callback，登录和真人验证交回 root", async () => {
  const fake = fixture()
  await fake.bridge.approve({ replace: true })
  const script = fake.input()
  for (const [snapshot, href, expected] of [
    [
      "确认授权",
      "http://127.0.0.1:43123/oauth/callback?flow_id=fixture-id&code=fixture&state=fixture%2Bstate",
      "authorized",
    ],
    [
      "确认授权",
      "https://evil.test/oauth/callback?flow_id=fixture-id&code=fixture&state=fixture%2Bstate",
      "unavailable",
    ],
    [
      "确认授权",
      "http://127.0.0.1:43123/oauth/callback?flow_id=fixture-id&code=fixture&state=fixture%2Bstate&extra=x",
      "unavailable",
    ],
    ...[
      "flow_id=wrong&code=x&state=fixture%2Bstate",
      "flow_id=fixture-id&code=x&state=wrong",
      "flow_id=fixture-id&code=&state=fixture%2Bstate",
      "flow_id=fixture-id&flow_id=fixture-id&code=x&state=fixture%2Bstate",
      "code=x&state=fixture%2Bstate",
      "flow_id=&code=x&state=fixture%2Bstate",
      "flow_id=fixture-id&code=x&state=",
      "flow_id=fixture-id&code=x&code=x&state=fixture%2Bstate",
    ].map((query) => ["确认授权", `http://127.0.0.1:43123/oauth/callback?${query}`, "unavailable"]),
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
        stdin: Readable.from([]),
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

test("未知 stdout/stderr 与合法 marker 混合仍拒绝", async () => {
  const marker = 'PIGCLAUDE_EGO_RESULT={"status":"ready-for-approval"}\n'
  for (const text of [
    "fixture-secret\n",
    "notice update\n",
    "[ego-browser:notice] arbitrary fixture-secret\n",
  ]) {
    await expect(fixture(text + marker).bridge.open(url)).rejects.toThrow(/^Ego授权委托失败$/)
    await expect(fixture(marker + text).bridge.open(url)).rejects.toThrow(/^Ego授权委托失败$/)
  }
  await expect(fixture(marker, 0, "fixture-secret").bridge.open(url)).rejects.toThrow(
    /^Ego授权委托失败$/,
  )
})

test("approve 拒绝完整 URL 反例及非 agent ownership，零页面动作", async () => {
  const fake = fixture()
  await fake.bridge.approve({ replace: true })
  const script = fake.input()
  for (const [current, ownership] of [
    [url + "&unknown=x", "agent"],
    [url + "&state=x", "agent"],
    [url + "#x", "agent"],
    [url.replace("https://", "https://user@"), "agent"],
    [url.replace("pigclaude-desktop", "wrong"), "agent"],
    [url.replace("pigclaude-login", "wrong"), "agent"],
    [url.replace("state=fixture%2Bstate", "state="), "agent"],
    [url, "user"],
  ]) {
    const clicks: string[] = []
    const output: string[] = []
    let pages = 0
    await (runInNewContext(`(async () => {${script}})()`, {
      process: {
        stdin: Readable.from([]),
      },
      Buffer,
      URL,
      console: { log: (text: string) => output.push(text) },
      taskSpace: async () => ({
        ownership,
        page: () => {
          pages++
          return {
            url: async () => current,
            snapshot: async () => "确认授权",
            click: async (selector: string) => {
              clicks.push(selector)
            },
            waitForSelector: async () => {},
            evaluate: async () => "http://127.0.0.1:43123/oauth/callback?code=x&state=y",
          }
        },
      }),
    }) as Promise<void>)
    expect(clicks).toEqual([])
    expect(output).toEqual(['PIGCLAUDE_EGO_RESULT={"status":"unavailable"}'])
    if (ownership !== "agent") expect(pages).toBe(0)
  }
})

function lifecycleFixture(killFails = false) {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => {
      kills++
      if (killFails) throw new Error("fixture-secret")
      return false
    },
  })
  let kills = 0
  let spawns = 0
  const launch = (() => {
    spawns++
    return child as unknown as ChildProcessWithoutNullStreams
  }) as unknown as typeof spawn
  const bridge = createEgoAuthorizationBridge({
    launch,
    gate: () => {},
    timeoutMs: 5,
    cleanupWaitMs: 5,
  })
  return { child, bridge, launch, kills: () => kills, spawns: () => spawns }
}

test("超时与kill失败保留owner跨实例锁；迟到close只释放退出确认", async () => {
  test.setTimeout(1000)
  for (const killFails of [false, true]) {
    const fake = lifecycleFixture(killFails)
    const pending = fake.bridge.open(url)
    const other = createEgoAuthorizationBridge({ launch: fake.launch, gate: () => {} })
    expect(await other.approve({ replace: false })).toBe("cleanup-unconfirmed")
    expect(await pending).toBe("cleanup-unconfirmed")
    expect(fake.kills()).toBe(1)
    expect(await other.open(url)).toBe("cleanup-unconfirmed")
    expect(fake.spawns()).toBe(1)
    fake.child.stdout.write('PIGCLAUDE_EGO_RESULT={"status":"authorized"}')
    fake.child.emit("close", 0)
    expect(await fixture().bridge.open(url)).toBe("ready-for-approval")
  }
})

test("spawn error等close确认；错误与超时后的close绝不成功", async () => {
  test.setTimeout(1000)
  const fake = lifecycleFixture()
  const pending = fake.bridge.open(url)
  fake.child.emit("error", new Error("fixture-secret"))
  fake.child.stdout.write('PIGCLAUDE_EGO_RESULT={"status":"ready-for-approval"}')
  fake.child.emit("close", 0)
  await expect(pending).rejects.toThrow(/^Ego授权委托失败$/)
  expect(await fixture().bridge.open(url)).toBe("ready-for-approval")
})

test("只接受已核实的完整更新notice，两输出流均不当作授权事实", async () => {
  const notice =
    "[ego-browser:notice] Ego Lite update is available (current 0.5.1.13). Finish the current browser task, then ask the user before running `ego-browser upgrade`; re-read the ego-browser Skill afterward."
  const marker = 'PIGCLAUDE_EGO_RESULT={"status":"ready-for-approval"}\n'
  expect(await fixture(notice + "\n" + marker).bridge.open(url)).toBe("ready-for-approval")
  expect(await fixture(marker, 0, notice + "\n").bridge.open(url)).toBe("ready-for-approval")
  await expect(fixture(notice + " fixture-secret\n" + marker).bridge.open(url)).rejects.toThrow(
    /^Ego授权委托失败$/,
  )
  await expect(fixture(notice + "\n").bridge.open(url)).rejects.toThrow(/^Ego授权委托失败$/)
})

test("spawn error无close时保留owner，确认失败close之后才允许新委托", async () => {
  const fake = lifecycleFixture()
  const pending = fake.bridge.open(url)
  fake.child.emit("error", new Error("fixture-secret"))
  expect(await pending).toBe("cleanup-unconfirmed")
  expect(await fixture().bridge.open(url)).toBe("cleanup-unconfirmed")
  fake.child.emit("close", -1)
  expect(await fixture().bridge.open(url)).toBe("ready-for-approval")
})

test("超时后close即使携带合法输出也只返回失败；同步spawn失败安全处理", async () => {
  const fake = lifecycleFixture()
  const pending = fake.bridge.open(url)
  setTimeout(() => {
    fake.child.stdout.write('PIGCLAUDE_EGO_RESULT={"status":"ready-for-approval"}')
    fake.child.emit("close", 0)
  }, 7)
  await expect(pending).rejects.toThrow(/^Ego授权委托失败$/)
  const bridge = createEgoAuthorizationBridge({
    gate: () => {},
    launch: (() => {
      throw new Error("fixture-secret")
    }) as typeof spawn,
  })
  await expect(bridge.open(url)).rejects.toThrow(/^Ego授权委托失败$/)
  expect(await fixture().bridge.open(url)).toBe("ready-for-approval")
})

test("真实CLI形态：完整stdin源码独立执行，URL字节安全保留且不读额外stdin", async () => {
  const sensitiveFixture =
    'https://pigclaude.com/authorize/fixture-id/approve?state=fixture";globalThis.fixtureInjected=true;//\\end\u2028line'
  const fake = fixture()
  await fake.bridge.open(sensitiveFixture)
  expect(fake.calls[0]?.[1]).toEqual(["nodejs"])
  const observed: string[] = []
  const output: string[] = []
  const context = {
    URL,
    process: { stdin: Readable.from([]) },
    console: { log: (text: string) => output.push(text) },
    taskSpace: async () => ({
      ownership: "agent",
      page: () => ({
        goto: async (value: string) => {
          observed.push(value)
        },
        url: async () => sensitiveFixture,
        snapshot: async () => "确认授权",
      }),
    }),
    fixtureInjected: false,
  }
  await (runInNewContext(`(async () => {${fake.input()}})()`, context) as Promise<void>)
  expect(observed).toEqual([sensitiveFixture])
  expect(context.fixtureInjected).toBe(false)
  expect(output).toEqual(['PIGCLAUDE_EGO_RESULT={"status":"ready-for-approval"}'])
  expect(JSON.stringify(fake.calls)).not.toContain(sensitiveFixture)
})

test("真实stderr marker加notice接受，两流重复或未知文本拒绝", async () => {
  const notice =
    "[ego-browser:notice] Ego Lite update is available (current 0.5.1.13). Finish the current browser task, then ask the user before running `ego-browser upgrade`; re-read the ego-browser Skill afterward."
  const marker = 'PIGCLAUDE_EGO_RESULT={"status":"ready-for-approval"}\n'
  expect(await fixture("", 0, marker + notice + "\n").bridge.open(url)).toBe("ready-for-approval")
  for (const [stdout, stderr] of [
    [marker, marker],
    ["fixture-secret\n", marker],
    [marker, "fixture-secret\n"],
    ["", marker + "fixture-secret\n"],
  ]) {
    await expect(fixture(stdout, 0, stderr).bridge.open(url)).rejects.toThrow(/^Ego授权委托失败$/)
  }
})
