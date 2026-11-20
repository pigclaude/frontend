// 使用进程内的合成网页检查原生 Chromium 的 Agent 分区，不访问远程或真实账号。

const { app, BrowserWindow, nativeImage, screen, webContents } = require("electron")
const { createServer } = require("node:http")
const { networkInterfaces } = require("node:os")
const { mkdirSync } = require("node:fs")
const { join } = require("node:path")
const assert = require("node:assert/strict")
const { WorkbenchBrowsers } = require("./main/workbench/browser-surface.js")
const { configureAgentBrowserRuntime } = require("./main/workbench/agent-browser-network.js")
const { typingProbe } = require("./agent-browser-input-probe.cjs")

const highDpi = process.argv.includes("--high-dpi-only")
configureAgentBrowserRuntime(app.commandLine)

const userData = join(__dirname, "user-data")
mkdirSync(userData)
app.setPath("userData", userData)
// 各轮探针分别销毁自己的窗口，等全部通过后再退出。
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
  const scope = { id: "agent-post-popup-probe", sessionId: "popup-session" }
  try {
    const first = JSON.parse(await browsers.agentPage(owner, scope, site.url))
    let last = first
    submit = true
    for (
      let index = 0;
      index < 40 && targetRequests === 0 && last.blockedRequests === first.blockedRequests;
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 75))
      last = JSON.parse(await browsers.agentPage(owner, scope))
    }
    assert.equal(targetRequests, 0, "POST popup must not request its target")
    assert.equal(last.blockedRequests, first.blockedRequests + 1)
    assert.equal(last.url, site.url + "/")
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    process.stdout.write("PASS Agent POST popup blocked without a target request\n")
  } finally {
    await browsers.closeWindow(owner)
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
  const scope = { id: "agent-malformed-policy-probe", sessionId: "malformed-policy-session" }
  try {
    for (const path of policies.keys()) {
      await browsers.agentPage(owner, scope, site.url + path)
      const status = await readFixtureResult(
        async () => JSON.parse(await browsers.agentPage(owner, scope)).text,
      )
      assert.equal(status, "NotAllowedError", path)
    }
    process.stdout.write("PASS Agent malformed Connection-Allowlist fails closed\n")
  } finally {
    await browsers.closeWindow(owner)
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
  const scope = { id: "agent-webrtc-policy-probe", sessionId: "webrtc-policy-session" }
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
    const readAgent = async () => JSON.parse(await browsers.agentPage(owner, scope)).text
    await browsers.agentPage(owner, scope, site.url + "/agent")
    assert.deepEqual(await readFixtureResult(readAgent), normal)
    await browsers.agentPage(owner, scope, site.url + "/strict")
    assert.deepEqual(await readFixtureResult(readAgent), { ...normal, cross: "denied" })
    await browsers.agentPage(owner, scope, site.url + "/module")
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
    await browsers.closeWindow(owner)
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
  const scope = { id: "agent-network-probe", sessionId: "network-session" }
  try {
    const first = JSON.parse(await browsers.agentPage(owner, scope, initial.url))
    assert.equal(first.title, "Initial loopback")
    assert(first.blockedRequests >= 2)
    for (let index = 0; index < 20 && downloadsRequested === 0; index += 1)
      await new Promise((resolve) => setTimeout(resolve, 50))
    openNext = true
    const last = await waitForSnapshot(
      browsers,
      owner,
      scope,
      (page) => page.title === "Second loopback",
    )
    assert.equal(last.title, "Second loopback")
    assert.equal(last.url, next.url + "/")
    assert.equal(downloadsRequested, 1)
    assert(last.blockedRequests >= 3)
    await assert.rejects(browsers.agentPage(owner, scope, initial.url + "/redirect"))
    assert.equal(blockedTargetHits, 0)
    assert.equal(BrowserWindow.getAllWindows().length, 1)
    process.stdout.write(
      "PASS agent loopback partition, subresources, downloads and same-tab navigation\n",
    )
  } finally {
    await browsers.closeWindow(owner)
    owner.destroy()
    initial.close()
    next.close()
    blocked.close()
  }
}

async function waitForSnapshot(browsers, owner, scope, condition) {
  for (let index = 0; index < 40; index += 1) {
    const previous = await browsers.agentPage(owner, scope).then(JSON.parse, () => null)
    if (previous && condition(previous)) return previous
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("未看到测试页面的快照变化")
}

async function snapshotProbe() {
  const password = "fixture-password-omitted-from-snapshots"
  let change = { ref: "", navigate: false }
  const local = await listen("127.0.0.1", (request, response) => {
    if (request.url === "/change") {
      response.setHeader("Content-Type", "application/json")
      response.end(JSON.stringify(change))
      return
    }
    response.setHeader("Content-Type", "text/html")
    response.end(`<!doctype html><title>Ref test page</title>
      <h1>Snapshot heading</h1><h2>Form controls</h2><h3 hidden>Hidden heading</h3>
      <button id="original">Original action</button>
      <button id="decoy" data-ref="forged-ref">Decoy action</button>
      <button hidden>Hidden action</button>
      <div style="opacity:0"><button>Invisible action</button></div>
      <label>Password <input type="password" value="${password}"></label>
      <p>Visible page copy</p><span style="display:contents">Text without a wrapper box</span>
      <div style="height:0;border:1px solid;overflow:hidden">
        Collapsed copy<button>Collapsed action</button>
        <h3>Collapsed heading</h3>
      </div>
      <div style="width:80px;overflow-x:clip">
        <button style="margin-left:100px">Clipped action</button>
      </div>
      <div style="width:200px;height:30px;overflow:hidden">
        <div style="height:20px;overflow:auto">
          <div style="height:60px"></div><button>Scrollable action</button>
        </div>
      </div>
      <p>${"x".repeat(6200)}</p>
      <script>
        const timer = setInterval(async () => {
          const current = await fetch("/change").then((response) => response.json());
          if (!current.ref) return;
          const decoy = document.querySelector("#decoy");
          if (decoy) {
            const original = document.querySelector("#original");
            const key = Symbol.for("pigclaude.agent-browser-refs");
            const exposed = globalThis[key];
            if (Object.keys(original.dataset).length || exposed?.byRef?.has(current.ref)) {
              exposed?.byRef?.set(current.ref, decoy);
              document.title = "Page reached reference table";
              clearInterval(timer);
              return;
            }
            decoy.id = current.ref;
            decoy.setAttribute("data-ref", current.ref);
            globalThis[key] = {
              byRef: new Map([[current.ref, decoy]])
            };
          }
          if (current.navigate && location.pathname === "/first") {
            history.pushState(null, "", "/changed");
          }
          document.title = "Page attributes changed";
        }, 60);
      </script>`)
  })
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const browsers = new WorkbenchBrowsers()
  const scope = { id: "agent-snapshot-probe", sessionId: "snapshot-session" }
  const other = { id: "agent-other-snapshot-probe", sessionId: "other-snapshot-session" }
  try {
    await browsers.agentPage(owner, scope, local.url + "/first")
    browsers.setActiveSession(owner, scope.sessionId)
    browsers.present(
      owner,
      scope.id,
      { x: 0, y: 0, width: 800, height: 600, scale: 1 },
      scope.sessionId,
    )
    const initial = JSON.parse(await browsers.agentPage(owner, scope))
    assert.equal(initial.url, local.url + "/first")
    assert.equal(initial.title, "Ref test page")
    assert.deepEqual(initial.headings, [
      { level: 1, text: "Snapshot heading" },
      { level: 2, text: "Form controls" },
    ])
    assert(initial.text.includes("Visible page copy"))
    assert(initial.text.includes("Text without a wrapper box"))
    assert(initial.text.length <= 6000)
    assert(!initial.text.includes("Invisible action"))
    assert(!/Collapsed|Clipped/.test(initial.text))
    assert(initial.text.includes("Scrollable action"))
    assert.equal(
      initial.elements.some((element) => /Hidden|Invisible|Collapsed|Clipped/.test(element.name)),
      false,
    )
    assert(initial.elements.some((element) => element.name === "Scrollable action"))
    assert(initial.elements.some((element) => element.type === "password"))
    assert(!JSON.stringify(initial).includes(password))
    const original = initial.elements.find((element) => element.name === "Original action")
    assert(original)
    assert(original.ref && original.ref !== "forged-ref")
    await assert.rejects(browsers.agentElement(owner, scope, "forged-ref"), /new browser snapshot/i)
    await assert.rejects(
      browsers.agentElement(owner, { ...scope, sessionId: other.sessionId }, original.ref),
      /new browser snapshot/i,
    )
    await browsers.agentPage(owner, other, local.url + "/other-session")
    const otherSnapshot = JSON.parse(await browsers.agentPage(owner, other))
    const otherRef = otherSnapshot.elements.find(
      (element) => element.name === "Original action",
    )?.ref
    assert(otherRef && otherRef !== original.ref)
    await assert.rejects(browsers.agentElement(owner, other, original.ref), /new browser snapshot/i)

    change = { ref: original.ref, navigate: false }
    const changed = await waitForSnapshot(
      browsers,
      owner,
      scope,
      (page) =>
        page.title === "Page attributes changed" || page.title === "Page reached reference table",
    )
    assert.equal(changed.title, "Page attributes changed")
    assert.equal(
      changed.elements.find((element) => element.name === "Original action")?.ref,
      original.ref,
    )
    assert.equal((await browsers.agentElement(owner, scope, original.ref)).name, "Original action")
    assert.notEqual(
      changed.elements.find((element) => element.name === "Decoy action")?.ref,
      original.ref,
    )

    change = { ...change, navigate: true }
    const navigated = await waitForSnapshot(
      browsers,
      owner,
      scope,
      (page) => page.url === local.url + "/changed",
    )
    const newRef = navigated.elements.find((element) => element.name === "Original action")?.ref
    assert(newRef && newRef !== original.ref)
    await assert.rejects(browsers.agentElement(owner, scope, original.ref), /new browser snapshot/i)
    assert.equal((await browsers.agentElement(owner, scope, newRef)).name, "Original action")

    await browsers.agentPage(owner, scope, local.url + "/fresh-document")
    await assert.rejects(browsers.agentElement(owner, scope, newRef), /new browser snapshot/i)
    await browsers.closeAgent(scope.id)
    await assert.rejects(browsers.agentElement(owner, scope, newRef), /new browser snapshot/i)
    assert.equal((await browsers.agentElement(owner, other, otherRef)).name, "Original action")
    process.stdout.write(
      "PASS agent snapshot heading levels, isolated refs, navigation and session ownership\n",
    )
  } finally {
    await browsers.closeWindow(owner)
    owner.destroy()
    local.close()
  }
}

async function actionProbe() {
  let visits = 0
  const local = await listen("127.0.0.1", (request, response) => {
    visits += 1
    const name = request.url === "/second" ? "Second fixture" : "First fixture"
    response.setHeader("Content-Type", "text/html")
    response.end(`<!doctype html><title>${name}</title><h1>${name}</h1>
      <a href="/first">Return to first</a>
      <div style="height:900px"></div>
      <button onclick="if(event.isTrusted) document.querySelector('output').textContent='Clicked fixture'">Count action</button>
      <output>Waiting for the fixture click</output>`)
  })
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const browsers = new WorkbenchBrowsers()
  const scope = { id: "agent-action-probe", sessionId: "action-session" }
  const first = local.url + "/first"
  const second = local.url + "/second"
  const events = []
  const send = owner.webContents.send.bind(owner.webContents)
  owner.webContents.send = (channel, event) => {
    if (channel === "pigclaude:workbench-event" && event.id === scope.id) events.push(event)
    send(channel, event)
  }
  try {
    await owner.loadURL("data:text/html,<title>Workbench fixture</title>")
    const prepared = await browsers.prepareAgentNavigation(owner, scope, { url: first })
    assert.deepEqual(prepared.context, { kind: "navigate", action: "url", url: first })
    assert.equal(visits, 0)
    assert.equal(events.length, 0)
    const opened = JSON.parse(await prepared.execute())
    assert.equal(opened.title, "First fixture")
    assert.deepEqual(opened.headings, [{ level: 1, text: "First fixture" }])
    assert(!opened.text.includes("Clicked fixture"))
    browsers.setActiveSession(owner, scope.sessionId)
    browsers.present(
      owner,
      scope.id,
      { x: 0, y: 0, width: 800, height: 600, scale: 1 },
      scope.sessionId,
    )
    owner.showInactive()
    const ready = await waitForSnapshot(browsers, owner, scope, (page) =>
      page.elements.some((element) => element.name === "Count action"),
    )
    const control = ready.elements.find((element) => element.name === "Count action")
    assert(control)
    const targetContents = webContents
      .getAllWebContents()
      .find((contents) => contents.getURL() === first)
    assert(targetContents)
    if (highDpi) assert.equal(await targetContents.executeJavaScript("devicePixelRatio"), 1.5)
    const click = await browsers.prepareAgentClick(owner, scope, control.ref)
    assert.deepEqual(click.context, {
      kind: "click",
      url: first,
      ref: control.ref,
      role: "button",
      name: "Count action",
    })
    assert(!JSON.parse(await browsers.agentPage(owner, scope)).text.includes("Clicked fixture"))
    assert.equal(await targetContents.executeJavaScript("scrollY"), 0)
    const clicked = JSON.parse(await click.execute())
    assert(clicked.text.includes("Clicked fixture"), clicked.text)
    assert(clicked.elements.some((element) => element.name === "Count action"))
    const pages = events.filter((event) => event.type === "browser-page").map((event) => event.page)
    assert(
      pages.some((page) => page.activity?.kind === "navigate" && page.activity.target === first),
    )
    assert(
      pages.some(
        (page) => page.activity?.kind === "click" && page.activity.target === "Count action",
      ),
    )
    assert.equal(pages.at(-1).activity, undefined)

    const changed = await browsers.prepareAgentClick(owner, scope, control.ref)
    await targetContents.executeJavaScript(
      "document.querySelector('button').textContent = 'Renamed fixture action'",
    )
    await assert.rejects(changed.execute(), /new browser snapshot/i)
    const stale = await browsers.prepareAgentClick(owner, scope, control.ref)
    const next = await browsers.prepareAgentNavigation(owner, scope, { url: second })
    assert.equal(JSON.parse(await next.execute()).title, "Second fixture")
    await assert.rejects(stale.execute(), /new browser snapshot/i)
    const back = await browsers.prepareAgentNavigation(owner, scope, { action: "back" })
    assert.equal(back.context.url, first)
    assert.equal(JSON.parse(await back.execute()).url, first)
    const forward = await browsers.prepareAgentNavigation(owner, scope, { action: "forward" })
    assert.equal(forward.context.url, second)
    assert.equal(JSON.parse(await forward.execute()).url, second)
    const reload = await browsers.prepareAgentNavigation(owner, scope, { action: "reload" })
    assert.equal(reload.context.url, second)
    const reloaded = JSON.parse(await reload.execute())
    assert.equal(reloaded.title, "Second fixture")
    const link = reloaded.elements.find((element) => element.name === "Return to first")
    assert(link)
    const follow = await browsers.prepareAgentClick(owner, scope, link.ref)
    const followed = JSON.parse(await follow.execute())
    assert.equal(followed.url, first)
    assert.deepEqual(followed.headings, [{ level: 1, text: "First fixture" }])
    process.stdout.write("PASS approved agent navigation and native pointer click\n")
  } finally {
    await browsers.closeWindow(owner)
    owner.destroy()
    local.close()
  }
}

async function screenshotProbe() {
  const local = await listen("127.0.0.1", (_request, response) => {
    response.setHeader("Content-Type", "text/html")
    response.end(
      '<!doctype html><title>JPEG fixture</title><body style="background:#249"><h1>Screenshot fixture</h1></body>',
    )
  })
  const owner = new BrowserWindow({
    width: 960,
    height: 720,
    show: false,
    webPreferences: { sandbox: true },
  })
  const browsers = new WorkbenchBrowsers()
  const scope = { id: "agent-screenshot-probe", sessionId: "screenshot-session" }
  try {
    await owner.loadURL(
      "data:text/html,<title>Workbench fixture</title><main>Workbench fixture</main>",
    )
    owner.showInactive()
    await browsers.agentPage(owner, scope, local.url)
    browsers.setActiveSession(owner, scope.sessionId)
    browsers.present(
      owner,
      scope.id,
      { x: 0, y: 0, width: highDpi ? 480 : 800, height: highDpi ? 320 : 600, scale: 1 },
      scope.sessionId,
    )
    const shown = await browsers.prepareAgentScreenshot(owner, scope)
    if (highDpi) {
      assert.equal(screen.getDisplayMatching(owner.getBounds()).scaleFactor, 1.5)
      const page = webContents
        .getAllWebContents()
        .find((contents) => contents.getURL() === local.url + "/")
      assert(page)
      assert.equal(await page.executeJavaScript("devicePixelRatio"), 1.5)
      assert.equal(shown.context.width, 720)
      assert.equal(shown.context.height, 480)
    }
    assert.equal((await shown.capture()).mimeType, "image/jpeg")
    browsers.present(owner, scope.id, null, scope.sessionId)
    const originallyAttached = owner.contentView.children.length
    const prepared = await browsers.prepareAgentScreenshot(owner, scope)
    assert(prepared.context.width > 0 && prepared.context.height > 0)
    assert(Math.max(prepared.context.width, prepared.context.height) <= 1280)
    assert(prepared.context.width * prepared.context.height <= 1_200_000)
    const shot = await prepared.capture()
    assert.equal(shot.mimeType, "image/jpeg")
    const bytes = Buffer.from(shot.data, "base64")
    assert.equal(bytes.readUInt16BE(), 0xffd8)
    const decoded = nativeImage.createFromBuffer(bytes)
    assert.equal(decoded.isEmpty(), false)
    assert.deepEqual(decoded.getSize(), {
      width: prepared.context.width,
      height: prepared.context.height,
    })
    const { width, height } = decoded.getSize()
    const pixel = 4 * (Math.floor(height * 0.75) * width + Math.floor(width / 2))
    const channels = [...decoded.toBitmap().subarray(pixel, pixel + 3)].sort((a, b) => a - b)
    assert.equal(channels.length, 3)
    assert(channels.every((value, index) => Math.abs(value - [34, 68, 153][index]) < 15))
    assert.equal(owner.contentView.children.length, originallyAttached)

    await browsers.agentPage(owner, scope, local.url + "/new-document")
    await assert.rejects(prepared.capture(), /new screenshot approval/i)
    process.stdout.write(
      "PASS hidden Agent tab JPEG matches approved size and rejects a changed document\n",
    )
  } finally {
    await browsers.closeWindow(owner)
    owner.destroy()
    local.close()
  }
}

app
  .whenReady()
  .then(async () => {
    if (highDpi) {
      await actionProbe()
      await screenshotProbe()
      process.stdout.write(
        "PASS 150% renderer click and 720x480 JPEG on " + process.platform + "\n",
      )
      return
    }
    if (process.argv.includes("--type-only")) return typingProbe(listen)
    if (process.argv.includes("--screenshot-only")) {
      await screenshotProbe()
      return
    }
    const snapshotOnly = process.argv.includes("--snapshot-only")
    const actionsOnly = process.argv.includes("--actions-only")
    if (!snapshotOnly && !actionsOnly) {
      await verifyPostPopupBlocked()
      await verifyAgentWebRtcBlocked()
      await verifyMalformedAllowlistBlocked()
      await probe()
    }
    if (!actionsOnly) await snapshotProbe()
    if (!snapshotOnly) await actionProbe()
    if (!snapshotOnly && !actionsOnly) {
      await typingProbe(listen)
      await screenshotProbe()
    }
  })
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error)
      app.exit(1)
    },
  )
