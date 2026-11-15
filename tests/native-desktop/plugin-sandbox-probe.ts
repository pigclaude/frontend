// 在真实 Electron 里用合成模块检验权限、文件与网络隔离，以及调用超时、取消、崩溃和回收。
import assert from "node:assert/strict"
import { writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { join } from "node:path"
import { setTimeout as wait } from "node:timers/promises"
import { pathToFileURL } from "node:url"
import { app, BrowserWindow } from "electron"
import { PluginSandboxHost } from "../../apps/desktop/src/main/plugins/plugin-sandbox-host"
import type { PluginSandboxSource } from "../../apps/desktop/src/main/plugins/plugin-sandbox-contract"
import {
  createElectronPluginSandboxLaunch,
  registerPluginSandboxScheme,
} from "../../apps/desktop/src/main/plugins/plugin-sandbox-window"

const profile = required("PIGCLAUDE_PROBE_PROFILE")
const preload = required("PIGCLAUDE_PROBE_PRELOAD")
app.setPath("userData", profile)
registerPluginSandboxScheme()
app.on("window-all-closed", () => {})

const source: PluginSandboxSource = {
  pluginId: "sandbox-fixture",
  revision: "1",
  egressId: "main-route",
  entry: "index.mjs",
  modules: {
    "helper.mjs": 'export const marker = "fixture-import"',
    "index.mjs": `
      import { marker } from "./helper.mjs";
      let counter = 0;
      const blocked = async (uri) => {
        try { await fetch(uri); return false; } catch { return true; }
      };
      export default async (operation, input) => {
        if (operation === "counter") return ++counter;
        if (operation === "raise") throw new Error("synthetic-private-error");
        if (operation === "large") return "x".repeat(600000);
        if (operation === "busy") {
          const end = performance.now() + 3000;
          while (performance.now() < end) {}
          return null;
        }
        let evalBlocked = false;
        try { eval("1 + 1"); } catch { evalBlocked = true; }
        let nestedBlocked = false;
        try {
          const nested = new Worker("/runtime/worker.mjs", {type: "module"});
          nestedBlocked = await new Promise(resolve => {
            nested.onerror = () => resolve(true);
            setTimeout(() => resolve(false), 150);
          });
          nested.terminate();
        } catch { nestedBlocked = true; }
        return {
          marker,
          require: typeof require,
          process: typeof process,
          window: typeof window,
          rtc: typeof RTCPeerConnection,
          fileBlocked: await blocked(input.file),
          networkBlocked: await blocked(input.network),
          evalBlocked,
          nestedBlocked,
        };
      };
    `,
  },
}
const counter = { operation: "counter", input: null } as const
const busy = { operation: "busy", input: null } as const

void app
  .whenReady()
  .then(verify)
  .then(
    () => app.exit(0),
    (error: unknown) => {
      console.error(error)
      app.exit(1)
    },
  )

async function verify(): Promise<void> {
  const host = new PluginSandboxHost(createElectronPluginSandboxLaunch(preload), { idleMs: 2_000 })
  try {
    if (process.env.PIGCLAUDE_PROBE_SANDBOX_DISABLED === "1") {
      await assert.rejects(host.invoke(source, counter), { message: "PLUGIN_SANDBOX_UNAVAILABLE" })
      assert.equal(BrowserWindow.getAllWindows().length, 0)
      console.log("PASS 无沙箱模式在创建窗口前拒绝插件")
      return
    }
    await verifyIsolation(host)
    await verifyRecovery(host)
    await wait(2_150)
    assert.equal(BrowserWindow.getAllWindows().length, 0)
    await verifyIdlePartitionReuse()
    console.log("PASS 沙箱窗口与 Worker 完成隔离、超时、取消、崩溃退避和空闲释放")
  } finally {
    await host.dispose()
  }
}

async function verifyIdlePartitionReuse(): Promise<void> {
  const host = new PluginSandboxHost(createElectronPluginSandboxLaunch(preload), { idleMs: 40 })
  const valueSource: PluginSandboxSource = {
    pluginId: "idle-number-review",
    revision: "1",
    egressId: "fixed",
    entry: "number.mjs",
    modules: { "number.mjs": "export default () => 7" },
  }
  const call = { operation: "number", input: null } as const
  try {
    assert.equal(await host.invoke(valueSource, call), 7)
    const first = BrowserWindow.getAllWindows()[0]?.webContents.session
    assert.ok(first)
    await waitForIdleWindows()

    assert.equal(await host.invoke(valueSource, call), 7)
    const reused = BrowserWindow.getAllWindows()[0]?.webContents.session
    assert.ok(reused === first, "同一插件版本和出口的空闲重启应复用已清理分区")
  } finally {
    await host.dispose()
  }
}

async function waitForIdleWindows(): Promise<void> {
  for (let attempt = 0; attempt < 100 && BrowserWindow.getAllWindows().length > 0; attempt++)
    await wait(20)
  assert.equal(BrowserWindow.getAllWindows().length, 0)
}

async function verifyIsolation(host: PluginSandboxHost): Promise<void> {
  let requests = 0
  const server = createServer((_request, response) => {
    requests += 1
    response.end("synthetic network")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("缺少本机测试地址")
    const file = join(profile, "fixture.txt")
    await writeFile(file, "synthetic file")
    const network = `http://127.0.0.1:${address.port}/probe`
    assert.deepEqual(
      await host.invoke(source, {
        operation: "inspect",
        input: { file: pathToFileURL(file).href, network },
      }),
      {
        marker: "fixture-import",
        require: "undefined",
        process: "undefined",
        window: "undefined",
        rtc: "undefined",
        fileBlocked: true,
        networkBlocked: true,
        evalBlocked: true,
        nestedBlocked: true,
      },
    )
    assert.equal(requests, 0)
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) throw new Error("缺少插件沙箱窗口")
    const contents = window.webContents
    assert.equal(window.isVisible(), false)
    assert.equal(contents.session.isPersistent(), false)
    assert.equal(contents.getWebRTCIPHandlingPolicy(), "disable_non_proxied_udp")
    assert.equal(
      await contents.executeJavaScript(
        'navigator.permissions.query({name: "geolocation"}).then(value => value.state)',
      ),
      "denied",
    )
    assert.equal(
      await contents.executeJavaScript(`window.open(${JSON.stringify(network)}) === null`),
      true,
    )
    const original = contents.getURL()
    await contents.executeJavaScript(`window.location.href = ${JSON.stringify(network)}; void 0`)
    await wait(50)
    assert.equal(contents.getURL(), original)
    assert.equal(requests, 0)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

async function verifyRecovery(host: PluginSandboxHost): Promise<void> {
  assert.equal(await host.invoke(source, counter), 1)
  assert.equal(await host.invoke(source, counter), 2)
  assert.equal(await host.invoke({ ...source, egressId: "isolated-route" }, counter), 1)
  assert.equal(BrowserWindow.getAllWindows().length, 2)
  await assert.rejects(host.invoke(source, { operation: "raise", input: null }), {
    message: "PLUGIN_EXECUTION_FAILED",
  })
  await assert.rejects(host.invoke(source, { operation: "large", input: null }), {
    message: "PLUGIN_RESULT_INVALID",
  })
  await assert.rejects(host.invoke(source, busy, { timeoutMs: 100 }), { message: "PLUGIN_TIMEOUT" })
  assert.equal(await host.invoke(source, counter), 1)

  const abort = new AbortController()
  const aborted = assert.rejects(host.invoke(source, busy, { signal: abort.signal }), {
    message: "PLUGIN_CANCELLED",
  })
  await wait(50)
  abort.abort()
  await aborted
  const existing = new Set(BrowserWindow.getAllWindows())
  assert.equal(await host.invoke(source, counter), 1)

  const window = BrowserWindow.getAllWindows().find((item) => !existing.has(item))
  if (!window) throw new Error("缺少崩溃用沙箱窗口")
  const pending = assert.rejects(host.invoke(source, busy), { message: "PLUGIN_SANDBOX_CRASHED" })
  await wait(60)
  window.webContents.forcefullyCrashRenderer()
  await pending
  await assert.rejects(host.invoke(source, counter), { message: "PLUGIN_SANDBOX_BACKOFF" })
  await wait(1_100)
  assert.equal(await host.invoke(source, counter), 1)
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`缺少探针输入 ${name}`)
  return value
}
