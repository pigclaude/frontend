// 在真实 Electron 插件沙箱中核对合成账号出口，只访问固定回环夹具。
import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"
import { createServer as httpServer } from "node:http"
import { createServer as httpsServer } from "node:https"
import { connect, type AddressInfo, type Socket } from "node:net"
import type { Duplex } from "node:stream"
import { join } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { getCACertificates, setDefaultCACertificates } from "node:tls"
import { app } from "electron"
import { PluginSandboxHost } from "../../apps/desktop/src/main/plugins/plugin-sandbox-host"
import type { PluginSandboxNetwork } from "../../apps/desktop/src/main/plugins/plugin-sandbox-contract"
import { createElectronPluginSandboxLaunch, registerPluginSandboxScheme } from "../../apps/desktop/src/main/plugins/plugin-sandbox-window"
import { account, harness, proxy } from "../../apps/desktop/src/main/runtime/local-runtime-fixtures"

const scratch = process.cwd()
assert.ok(process.env.PIGCLAUDE_EGRESS_QA === "1")
assert.equal(process.versions.electron, "43.8.12")
app.setPath("userData", join(scratch, "profile"))
registerPluginSandboxScheme()
app.on("window-all-closed", () => {})

const permission = {
  declaredDomains: ["localhost", "unconfirmed.localhost"],
  approvedDomains: ["localhost"],
}
const dispatch = {
  pluginId: "egress-acceptance",
  revision: "1",
  entry: "egress.mjs",
  modules: {
    "egress.mjs": [
      "export default async (_operation, endpoint) => {",
      "  try {",
      "    const response = await fetch(endpoint);",
      "    return { status: response.status, content: await response.text() };",
      "  } catch {",
      "    return { status: null, content: null };",
      "  }",
      "};",
    ].join("\n"),
  },
}

void app.whenReady().then(verify).then(
  () => app.exit(0),
  (error: unknown) => {
    console.error(error)
    app.exit(1)
  },
)

async function verify(): Promise<void> {
  const cert = await readFile("fixture-cert.pem", "utf8")
  const key = await readFile("fixture-key.pem", "utf8")
  setDefaultCACertificates([...getCACertificates("default"), cert])
  const hits: string[] = []
  const tunnels: string[] = []
  let originConnections = 0
  let proxyConnections = 0
  const transport: Record<string, {origin: number; proxy: number}> = {}
  const proxySockets = new Set<Socket | Duplex>()
  const stages: { phase: string; startedMs: number; endedMs: number }[] = []

  const origin = httpsServer({ cert, key }, (request, response) => {
    hits.push(request.url ?? "")
    response.writeHead(200, { "content-type": "text/plain" }).end("isolated fixture")
  })
  origin.on("connection", () => { originConnections += 1 })
  await new Promise<void>((resolve) => origin.listen(0, "127.0.0.1", resolve))
  const originPort = (origin.address() as AddressInfo).port
  const gateway = httpServer((_request, response) => response.writeHead(405).end())
  gateway.on("connect", (request, client, head) => {
    if (request.url !== "localhost:" + originPort)
      return client.end("HTTP/1.1 403 Forbidden\r\n\r\n")
    tunnels.push(request.url)
    const upstream = connect(originPort, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n")
      if (head.length > 0) upstream.write(head)
      client.pipe(upstream).pipe(client)
    })
    proxySockets.add(client)
    proxySockets.add(upstream)
    client.on("error", () => upstream.destroy())
    upstream.on("error", () => client.destroy())
  })
  gateway.on("connection", () => { proxyConnections += 1 })
  await new Promise<void>((resolve) => gateway.listen(0, "127.0.0.1", resolve))
  const proxyPort = (gateway.address() as AddressInfo).port
  const host = new PluginSandboxHost(createElectronPluginSandboxLaunch(join(scratch, "plugin-preload.js")))

  const runtime = await harness({
    accounts: [
      account("local-route", { proxyId: null }),
      account("proxy-route", { proxyId: "loopback-account-proxy" }),
    ],
    proxies: [{
      ...proxy("loopback-account-proxy"),
      url: "http://127.0.0.1:" + proxyPort,
    }],
  })
  const call = (route: PluginSandboxNetwork, domain: string, path: string) => host.invoke({
    ...dispatch,
    egressId: route.egressId,
    network: route,
  }, {
    operation: "request",
    input: "https://" + domain + ":" + originPort + path,
  })
  async function record<T>(phase: string, work: () => Promise<T>): Promise<T> {
    const startedMs = Date.now()
    const beforeOrigin = originConnections
    const beforeProxy = proxyConnections
    const result = await work()
    await delay(450)
    stages.push({ phase, startedMs, endedMs: Date.now() })
    transport[phase] = { origin: originConnections - beforeOrigin, proxy: proxyConnections - beforeProxy }
    return result
  }
  try {
    await runtime.runtime.start()
    const daemon = runtime.daemons[0]
    assert.ok(daemon)
    runtime.runtime.openSession({ sessionId: "direct", preferredAccountId: "local-route" })
    runtime.runtime.openSession({ sessionId: "proxied", preferredAccountId: "proxy-route" })
    daemon.options.onAccountSelected("direct", "local-route", undefined)
    daemon.options.onAccountSelected("proxied", "proxy-route", undefined)
    const direct = await runtime.runtime.pluginNetwork("direct", permission)
    const proxied = await runtime.runtime.pluginNetwork("proxied", permission)
    assert.deepEqual(direct.domains, ["localhost"])
    assert.notEqual(proxied.egressId, direct.egressId)
    await writeFile("wire-ports.json", JSON.stringify({ origin: originPort, proxy: proxyPort }) + "\n")
    const expires = Date.now() + 90000
    while (!(await readFile("capture-ready", "utf8").catch(() => "")).startsWith("ready")) {
      assert.ok(Date.now() < expires, "packet capture did not start")
      await delay(350)
    }

    const healthy = { status: 200, content: "isolated fixture" }
    const blocked = { status: null, content: null }

    assert.deepEqual(await record("direct-control", () => call(direct, "localhost", "/direct")), healthy)
    for (const name of ["unconfirmed.localhost", "outside.localhost"]) {
      assert.deepEqual(await record("denied-" + name, () => call(direct, name, "/denied")), blocked)
    }
    assert.deepEqual(hits, ["/direct"])
    assert.deepEqual(tunnels, [])

    assert.deepEqual(await record("bound-proxy", () => call(proxied, "localhost", "/proxied")), healthy)
    assert.deepEqual(hits, ["/direct", "/proxied"])
    assert.equal(tunnels.length, 1)

    for (const socket of proxySockets) socket.destroy()
    await new Promise<void>((resolve) => gateway.close(() => resolve()))
    assert.deepEqual(await record("stopped-proxy", () => call(proxied, "localhost", "/must-not-arrive")), blocked)
    assert.deepEqual(hits, ["/direct", "/proxied"])

    assert.deepEqual(await record("direct-still-available", () => call(direct, "localhost", "/control-after")), healthy)
    assert.deepEqual(hits, ["/direct", "/proxied", "/control-after"])
    assert.equal(tunnels.length, 1)
    assert.deepEqual(transport["denied-unconfirmed.localhost"], { origin: 0, proxy: 0 })
    assert.deepEqual(transport["denied-outside.localhost"], { origin: 0, proxy: 0 })
    assert.ok(transport["bound-proxy"].origin > 0 && transport["bound-proxy"].proxy > 0)
    assert.deepEqual(transport["stopped-proxy"], { origin: 0, proxy: 0 })
    assert.ok(transport["direct-still-available"].origin > 0)
    await writeFile("egress-result.json", JSON.stringify({
      passed: true,
      runtime: process.versions.electron,
      accountSource: "synthetic selected accounts in actual LocalRuntime",
      nativePluginWorker: true,
      allowedDomains: direct.domains,
      originPaths: hits,
      tunnels: tunnels.length,
      transport,
      stages,
    }, null, 2) + "\n")
    console.log("PLUGIN_EGRESS_WIRE_CHECK_PASSED")
  } finally {
    await host.dispose()
    await runtime.cleanup()
    origin.closeAllConnections()
    origin.close()
    for (const socket of proxySockets) socket.destroy()
    gateway.close()
  }
}
