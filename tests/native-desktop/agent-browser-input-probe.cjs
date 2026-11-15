// 在真实原生视图中向合成表单输入，确认工作台输入和其他字段保持原值。

const assert = require("node:assert/strict")
const { BrowserWindow, webContents } = require("electron")
const { BrowserActionError } = require("./main/workbench/browser-action-request.js")
const { WorkbenchBrowsers } = require("./main/workbench/browser-surface.js")

async function typingProbe(listen) {
  const visits = []
  const local = await listen("127.0.0.1", (request, response) => {
    visits.push(request.url)
    response.setHeader("Content-Type", "text/html")
    if (request.url.startsWith("/submitted?")) {
      response.end("<h1>Submission destination</h1>")
      return
    }
    response.end(`<!doctype html><title>Typing fixture</title><h1>Typing fixture</h1>
      <form>
        <label for="field">Fixture text</label>
        <input id="field" value="Original page value">
        <button>Submit fixture</button>
      </form>
      <output>Waiting for fixture submission</output>
      <input id="private" type="password" aria-label="Private fixture">
      <input readonly aria-label="Read only fixture">
      <input id="neighbor" value="Neighbor original" aria-label="Neighbor fixture">
      <input id="redirect" aria-label="Redirected focus fixture">
      <input id="after-clear" value="Clear me first" aria-label="Moved focus after clear">
      <div id="editor" contenteditable="true">Original editor text</div>
      <button onclick="document.getElementById('clicked').textContent='Clicked already'">Guarded click fixture</button>
      <p id="clicked">Waiting for fixture click</p>
      <form action="/submitted">
        <input aria-label="Navigating fixture" name="value">
        <button>Navigate fixture</button>
      </form>
      <script>
        const neighbor = document.getElementById('neighbor');
        document.getElementById('redirect').addEventListener('focus', () => neighbor.focus());
        document.getElementById('after-clear').addEventListener('input', () => neighbor.focus());
        document.querySelector('form').addEventListener('submit', (event) => {
          event.preventDefault();
          if (event.isTrusted) {
            document.querySelector('output').textContent =
              'Submitted fixture: ' + document.getElementById('field').value;
          }
        });
      </script>`)
  })
  const owner = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  const browsers = new WorkbenchBrowsers()
  const scope = { id: "agent-typing-probe", sessionId: "typing-session" }
  const { id, sessionId } = scope
  const url = local.url + "/"
  const text = "合成🙂"
  const activity = []
  const send = owner.webContents.send.bind(owner.webContents)
  owner.webContents.send = (channel, event) => {
    if (
      channel === "pigclaude:workbench-event" &&
      event.id === id &&
      event.type === "browser-page"
    ) {
      assert.equal(event.sessionId, sessionId)
      activity.push(event.page.activity)
    }
    send(channel, event)
  }
  try {
    const host = "<title>Workbench fixture</title><input autofocus value='Workbench original'>"
    await owner.loadURL("data:text/html," + encodeURIComponent(host))
    await browsers.agentPage(owner, scope, url)
    browsers.setActiveSession(owner, sessionId)
    browsers.present(owner, id, { x: 0, y: 0, width: 800, height: 600, scale: 1 }, sessionId)
    owner.showInactive()
    const fixture = webContents.getAllWebContents().find((contents) => contents.getURL() === url)
    assert(fixture)
    const page = JSON.parse(await browsers.agentPage(owner, scope))
    function reference(name) {
      const field = page.elements.find((element) => element.name === name)
      assert(field)
      return field.ref
    }
    const prepare = (name, text, { clear = false, submit = false } = {}) =>
      browsers.prepareAgentType(owner, scope, { ref: reference(name), text, clear, submit })

    await assert.rejects(
      browsers.prepareAgentType(
        owner,
        { id, sessionId: "different-session" },
        {
          ref: reference("Fixture text"),
          text,
          clear: true,
          submit: true,
        },
      ),
      /new browser snapshot/i,
    )

    const action = await prepare("Fixture text", text, { clear: true, submit: true })
    assert.deepEqual(action.context, {
      kind: "type",
      url,
      ref: reference("Fixture text"),
      role: "textbox",
      name: "Fixture text",
      isPassword: false,
      characterCount: 3,
      clear: true,
      submit: true,
    })
    assert.equal(
      await fixture.executeJavaScript("document.getElementById('field').value"),
      "Original page value",
    )
    assert.equal(await fixture.executeJavaScript("document.activeElement.id"), "")

    const typed = JSON.parse(await action.execute())
    assert(typed.text.includes("Submitted fixture: " + text), typed.text)
    assert.deepEqual(typed.headings, [{ level: 1, text: "Typing fixture" }])

    await assert.rejects(prepare("Read only fixture", text), /editable text field/i)
    await assert.rejects(prepare("Fixture text", "🙂".repeat(2049)), /input limit/i)

    const privateValue = "private value in fixture"
    const privateAction = await prepare("Private fixture", privateValue)
    assert.equal(privateAction.context.isPassword, true)
    assert.equal(privateAction.context.characterCount, 24)
    assert(!JSON.stringify(privateAction.context).includes(privateValue))
    assert(!(await privateAction.execute()).includes(privateValue))
    assert.equal(
      await fixture.executeJavaScript("document.getElementById('private').value"),
      privateValue,
    )
    assert(activity.some((entry) => entry?.kind === "type" && entry.target === "Private fixture"))
    assert(!JSON.stringify(activity).includes(privateValue))
    assert.equal(activity.at(-1), undefined)

    const changedInput = await prepare("Private fixture", "Stale fixture")
    await fixture.executeJavaScript("document.getElementById('private').type = 'text'")
    await assert.rejects(changedInput.execute(), /new browser snapshot/i)
    assert.equal(
      await fixture.executeJavaScript("document.getElementById('private').value"),
      privateValue,
    )

    const redirected = await prepare("Redirected focus fixture", text)
    await assert.rejects(redirected.execute(), /lost focus/i)
    const movedAfterClear = await prepare("Moved focus after clear", text, { clear: true })
    await assert.rejects(movedAfterClear.execute(), /lost focus/i)
    assert.equal(
      await fixture.executeJavaScript("document.getElementById('after-clear').value"),
      "",
    )
    assert.equal(
      await fixture.executeJavaScript("document.getElementById('neighbor').value"),
      "Neighbor original",
    )

    const editor = await prepare("Original editor text", "Edited fixture", { clear: true })
    assert.equal(editor.context.name, "")
    assert(JSON.parse(await editor.execute()).text.includes("Edited fixture"))

    async function losePermissionDuring(action) {
      let allowed = true
      const pending = action.execute(undefined, () => {
        if (!allowed) throw new BrowserActionError("Fixture permission withdrawn.")
      })
      allowed = false
      await assert.rejects(pending, /Fixture permission withdrawn/)
    }
    await losePermissionDuring(await prepare("Fixture text", "Revoked fixture"))
    assert.equal(await fixture.executeJavaScript("document.getElementById('field').value"), text)
    await losePermissionDuring(
      await browsers.prepareAgentClick(owner, scope, reference("Guarded click fixture")),
    )
    assert.equal(
      await fixture.executeJavaScript("document.getElementById('clicked').textContent"),
      "Waiting for fixture click",
    )
    await losePermissionDuring(
      await browsers.prepareAgentNavigation(owner, scope, { url: local.url + "/guarded" }),
    )
    assert(!visits.includes("/guarded"))

    const submitNavigation = await prepare("Navigating fixture", "Local fixture", { submit: true })
    const submitted = JSON.parse(await submitNavigation.execute())
    assert.equal(new URL(submitted.url).pathname, "/submitted")
    assert.deepEqual(submitted.headings, [{ level: 1, text: "Submission destination" }])
    assert.equal(
      await owner.webContents.executeJavaScript("document.querySelector('input').value"),
      "Workbench original",
    )
    process.stdout.write(
      "PASS approved browser input, focus checks and revoked writes stay in the owning view\n",
    )
  } finally {
    await browsers.closeWindow(owner)
    owner.destroy()
    local.close()
  }
}

module.exports = { typingProbe }
