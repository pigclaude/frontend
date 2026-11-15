// 使用进程内的合成网页检查原生 Chromium 的 Agent 分区，不访问远程或真实账号。

const { app, BrowserWindow } = require("electron")
const { createServer } = require("node:http")
const { networkInterfaces } = require("node:os")
const { mkdirSync } = require("node:fs")
const { join } = require("node:path")
const assert = require("node:assert/strict")
const { WorkbenchBrowsers } = require("./browser-surface.js")

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
  .then(probe)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error)
      app.exit(1)
    },
  )
