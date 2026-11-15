// 使用进程内的合成网页检查原生 Chromium 的 Agent 分区，不访问远程或真实账号。

const { app, BrowserWindow, webContents } = require("electron")
const { createServer } = require("node:http")
const { networkInterfaces } = require("node:os")
const { mkdirSync } = require("node:fs")
const { join } = require("node:path")
const assert = require("node:assert/strict")
const { WorkbenchBrowsers } = require("./browser-surface.js")
const { configureAgentBrowserRuntime } = require("./agent-browser-network.js")

configureAgentBrowserRuntime(app.commandLine)

const userData = join(__dirname, "user-data")
mkdirSync(userData)
app.setPath("userData", userData)
app.on("window-all-closed", () => {})

async function listen(host, handler) {
  const server = createServer(handler)
  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, host, resolve)
  })
  const url = `http://${host}:${server.address().port}`
  return {
    url,
    close: () => {
      server.closeAllConnections()
      server.close()
    },
  }
}

async function verifyPostPopupBlocked() {
  let submit = false
  let targetRequests = 0
  const site = await listen("127.0.0.1", (request, response) => {
    if (request.url === "/submit-ready") {
      response.end(submit ? "go" : "wait")
      return
    }
    if (request.url === "/form-target") {
      targetRequests += 1
      response.end("form target")
      return
    }
    response.setHeader("Content-Type", "text/html")
    response.end(`<!doctype html><title>Initial form page</title>
      <form method="post" action="/form-target" target="_blank">
        <input name="marker" value="synthetic">
      </form>
      <script>
        const timer = setInterval(async () => {
          const state = await fetch("/submit-ready").then((response) => response.text());
          if (state !== "go") return;
          clearInterval(timer);
          document.forms[0].requestSubmit();
        }, 60);
      </script>`)
  })
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const browsers = new WorkbenchBrowsers()
  const id = "agent-post-popup-probe"
  try {
    const first = JSON.parse(await browsers.agentPage(owner, id, site.url))
    let last = first
    submit = true
    for (
      let index = 0;
      index < 40 && targetRequests === 0 && last.blockedRequests === first.blockedRequests;
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 75))
      last = JSON.parse(await browsers.agentPage(owner, id))
    }
    assert.equal(targetRequests, 0, "POST popup must not request its target")
    assert.equal(last.blockedRequests, first.blockedRequests + 1)
    assert.equal(last.url, site.url + "/")
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    process.stdout.write("PASS Agent POST popup blocked without a target request\n")
  } finally {
    browsers.closeWindow(owner)
    owner.destroy()
    site.close()
  }
}

function peerStatus(frame) {
  try {
    const peer = new frame.RTCPeerConnection({ iceServers: [] })
    peer.close()
    return "available"
  } catch (error) {
    return error.name
  }
}

async function verifyMalformedAllowlistBlocked() {
  const policies = new Map([
    ["/wrong-member", "response-origin;webrtc=allow"],
    ["/malformed-value", "(response-origin);webrtc=?no"],
    ["/malformed-tail", ["(response-origin);webrtc=allow", "(response-origin"]],
  ])
  const site = await listen("127.0.0.1", (request, response) => {
    const policy = policies.get(request.url)
    if (policy === undefined) return response.writeHead(404).end()
    response.setHeader("Content-Type", "text/html")
    response.setHeader("Connection-Allowlist", policy)
    response.end(`<!doctype html><title>Malformed policy fixture</title><pre id="result"></pre>
      <script>
        ${peerStatus.toString()}
        document.getElementById("result").textContent = JSON.stringify(peerStatus(window));
      </script>`)
  })
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const browsers = new WorkbenchBrowsers()
  const id = "agent-malformed-policy-probe"
  try {
    for (const path of policies.keys()) {
      await browsers.agentPage(owner, id, site.url + path)
      const status = await readFixtureResult(
        async () => JSON.parse(await browsers.agentPage(owner, id)).text,
      )
      assert.equal(status, "NotAllowedError", path)
    }
    process.stdout.write("PASS Agent malformed Connection-Allowlist fails closed\n")
  } finally {
    browsers.closeWindow(owner)
    owner.destroy()
    site.close()
  }
}

async function verifyAgentWebRtcBlocked() {
  let agentWorkerRequests = 0
  const cross = await listen("127.0.0.1", (_request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*")
    response.end("cross-port")
  })
  const site = await listen("127.0.0.1", (request, response) => {
    if (request.url === "/same") return response.end("same-origin")
    if (request.url === "/agent-worker.js" || request.url === "/personal-worker.js") {
      if (request.url === "/agent-worker.js") agentWorkerRequests += 1
      response.setHeader("Content-Type", "application/javascript")
      response.end(
        "self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));" +
          "self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));" +
          "self.addEventListener('fetch', event => {" +
          "if (new URL(event.request.url).pathname === '/offline') " +
          "event.respondWith(new Response('<title>Personal offline page</title>offline', " +
          "{ headers: {'Content-Type': 'text/html'} })); });",
      )
      return
    }
    response.setHeader("Content-Type", "text/html")
    if (request.url === "/strict")
      response.setHeader(
        "Connection-Allowlist",
        "(response-origin);webrtc=allow, (response-origin);redirects=allow",
      )
    const worker = request.url === "/personal" ? "/personal-worker.js" : "/agent-worker.js"
    const workerType = request.url === "/module" ? "module" : "classic"
    response.end(`<!doctype html><title>Local policy fixture</title>
      <iframe id="blank"></iframe><iframe id="inline" srcdoc="Local frame"></iframe>
      <pre id="result"></pre>
      <script>
        ${peerStatus.toString()}
        async function read(url) {
          return fetch(url).then(response => response.text(), () => "denied");
        }
        window.addEventListener("load", async () => {
          const blob = URL.createObjectURL(new Blob(["local-blob"], { type: "text/plain" }));
          const result = {
            main: peerStatus(window),
            blank: peerStatus(document.getElementById("blank").contentWindow),
            inline: peerStatus(document.getElementById("inline").contentWindow),
            same: await read("/same"),
            cross: await read(${JSON.stringify(cross.url)}),
            data: await read("data:text/plain,local-data"),
            blob: await read(blob),
            worker: await navigator.serviceWorker.register(${JSON.stringify(worker)}, { type: ${JSON.stringify(workerType)} })
              .then(() => "registered", () => "denied"),
          };
          URL.revokeObjectURL(blob);
          document.getElementById("result").textContent = JSON.stringify(result);
        });
      </script>`)
  })
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const browsers = new WorkbenchBrowsers()
  const id = "agent-webrtc-policy-probe"
  const normal = {
    main: "NotAllowedError",
    blank: "NotAllowedError",
    inline: "NotAllowedError",
    same: "same-origin",
    cross: "cross-port",
    data: "local-data",
    blob: "local-blob",
    worker: "denied",
  }
  try {
    const readAgent = async () => JSON.parse(await browsers.agentPage(owner, id)).text
    await browsers.agentPage(owner, id, site.url + "/agent")
    assert.deepEqual(await readFixtureResult(readAgent), normal)
    await browsers.agentPage(owner, id, site.url + "/strict")
    assert.deepEqual(await readFixtureResult(readAgent), { ...normal, cross: "denied" })
    await browsers.agentPage(owner, id, site.url + "/module")
    assert.deepEqual(await readFixtureResult(readAgent), normal)
    assert.equal(agentWorkerRequests, 0)

    await browsers.navigate(owner, "personal-webrtc-probe", site.url + "/personal")
    const personal = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL() === site.url + "/personal")
    assert(personal)
    assert.deepEqual(
      await readFixtureResult(() =>
        personal.executeJavaScript("document.getElementById('result').textContent"),
      ),
      {
        ...normal,
        main: "available",
        blank: "available",
        inline: "available",
        worker: "registered",
      },
    )
    await personal.executeJavaScript(`navigator.serviceWorker.ready.then(async () => {
      if (!navigator.serviceWorker.controller)
        await new Promise(resolve => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
      return true;
    })`)
    await personal.loadURL(site.url + "/offline")
    assert.equal(personal.getTitle(), "Personal offline page")
    process.stdout.write(
      "PASS Agent native WebRTC and service worker restrictions, isolated from personal pages\n",
    )
  } finally {
    browsers.closeWindow(owner)
    owner.destroy()
    site.close()
    cross.close()
  }
}

async function readFixtureResult(read) {
  for (let index = 0; index < 40; index += 1) {
    const value = await read()
    if (value) return JSON.parse(value)
    await new Promise((resolve) => setTimeout(resolve, 75))
  }
  throw new Error("Local policy fixture did not complete")
}

async function probe() {
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((item) => item?.family === "IPv4" && !item.internal)
  if (!lan) throw new Error("原生测试缺少本机 IPv4 网卡")
  let blockedTargetHits = 0
  let downloadsRequested = 0
  let openNext = false
  const blocked = await listen(lan.address, (_request, response) => {
    blockedTargetHits += 1
    response.end("external synthetic target")
  })
  const next = await listen("127.0.0.1", (_request, response) => {
    response.setHeader("Content-Type", "text/html")
    response.end("<title>Second loopback</title>second local page")
  })
  const initial = await listen("127.0.0.1", (request, response) => {
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: blocked.url + "/redirected" }).end()
      return
    }
    if (request.url === "/next-ready") {
      response.end(openNext ? "go" : "wait")
      return
    }
    if (request.url === "/local.js") {
      response.setHeader("Content-Type", "application/javascript")
      response.end("document.body.dataset.script = 'loaded';")
      return
    }
    if (request.url === "/download") {
      downloadsRequested += 1
      response.setHeader("Content-Disposition", "attachment; filename=synthetic.txt")
      response.end("synthetic")
      return
    }
    response.setHeader("Content-Type", "text/html")
    response.end(`<!doctype html><title>Initial loopback</title>
      <img src="${blocked.url}/image">
      <iframe src="${blocked.url}/frame"></iframe>
      <iframe srcdoc="<p>inline frame</p>"></iframe>
      <p>first local page</p>
      <script src="/local.js"></script>
      <script>
        const download = document.createElement("a");
        download.href = "/download";
        download.download = "synthetic.txt";
        document.body.append(download);
        setTimeout(() => download.click(), 120);
        const nextTimer = setInterval(async () => {
          const state = await fetch("/next-ready").then((response) => response.text());
          if (state !== "go") return;
          clearInterval(nextTimer);
          window.open(${JSON.stringify(next.url)});
        }, 60);
      </script>`)
  })
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const browsers = new WorkbenchBrowsers()
  const id = "agent-network-probe"
  try {
    const first = JSON.parse(await browsers.agentPage(owner, id, initial.url))
    assert.equal(first.title, "Initial loopback")
    assert(first.blockedRequests >= 2)
    for (let index = 0; index < 20 && downloadsRequested === 0; index += 1)
      await new Promise((resolve) => setTimeout(resolve, 50))
    openNext = true
    let last = first
    for (let index = 0; index < 40 && last.title !== "Second loopback"; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      last = JSON.parse(await browsers.agentPage(owner, id))
    }
    assert.equal(last.title, "Second loopback")
    assert.equal(last.url, next.url + "/")
    assert.equal(downloadsRequested, 1)
    assert(last.blockedRequests >= 3)
    await assert.rejects(browsers.agentPage(owner, id, initial.url + "/redirect"))
    assert.equal(blockedTargetHits, 0)
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    process.stdout.write(
      "PASS agent loopback partition, subresources, downloads and same-tab navigation\n",
    )
  } finally {
    browsers.closeWindow(owner)
    owner.destroy()
    initial.close()
    next.close()
    blocked.close()
  }
}

app
  .whenReady()
  .then(verifyPostPopupBlocked)
  .then(verifyAgentWebRtcBlocked)
  .then(verifyMalformedAllowlistBlocked)
  .then(probe)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error)
      app.exit(1)
    },
  )
