// 在真实 Electron 工作台上验证 PTY、文件、Git、隔离浏览器和可选真实模型。
import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createServer } from "node:http"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import { expect } from "@playwright/test"
import { verifyTerminalDrawer } from "./terminal-drawer.mjs"

const exec = promisify(execFile)

/** 使用隔离 Git 仓库、网页与显式启用的供应商，不使用现有用户项目。 */
export async function verifyWorkbench(page, application, output, provider = false) {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-workbench-test-"))
  let failure
  const site = createServer((request, response) => {
    if (request.url === "/next") {
      response.writeHead(200, { "content-type": "text/html" })
      response.end("<title>Second preview</title><h1>Second page</h1>")
      return
    }
    response.writeHead(200, { "content-type": "text/html" })
    response.end(
      '<title>Workbench preview</title><h1 id="ready">Local preview</h1><a href="/next">Next page</a>',
    )
  })
  await new Promise((resolve, reject) => {
    site.once("error", reject)
    site.listen(0, "127.0.0.1", resolve)
  })
  const local = `http://127.0.0.1:${site.address().port}`
  const git = (args) => exec("git", args, { cwd: root, windowsHide: true })
  const settings = join(root, ".claude", "settings.json")
  const worktreeFile = join(root, ".claude", "worktrees", "example.txt")
  const savedSettings = '{ "env": { "WORKBENCH_PROJECT_SETTINGS": "saved" } }\n'
  try {
    await git(["init", "-q", "-b", "main"])
    await git(["config", "core.autocrlf", "false"])
    await writeFile(join(root, "example.txt"), "initial example\n")
    await mkdir(join(root, ".claude", "worktrees"), { recursive: true })
    await writeFile(settings, "{}\n")
    await writeFile(worktreeFile, "protected worktree file\n")
    await git(["add", "--", "example.txt", ".claude/settings.json"])
    await git([
      "-c",
      "user.name=Workbench QA",
      "-c",
      "user.email=qa@example.test",
      "commit",
      "-qm",
      "initial",
    ])
    await page.evaluate((root) => window.pigclaude.workspaces.add(root), root)
    await page.reload()
    await expect(page.locator("[data-main-window]")).toBeVisible()
    await verifyTerminalDrawer(page, root, output)
    await page.getByRole("button", { name: "切换右侧面板", exact: true }).click()
    const panel = page.locator(".right-panel-slot")
    await expect(panel).toBeVisible()
    const open = async (name) => {
      const existing = panel.getByRole("tab", { name, exact: true })
      if (await existing.count()) return existing.click()
      const add = panel.getByRole("button", { name: "添加面板", exact: true })
      if ((await panel.getByRole("tab").count()) > 0) {
        await add.click()
        await page.getByRole("menuitem", { name, exact: true }).click()
      } else {
        await panel.getByRole("button", { name, exact: true }).click()
      }
    }
    await open("终端")
    const terminal = panel.getByTestId("terminal-view")
    await expect(terminal).toBeVisible()
    const prompt = terminal.locator("textarea")
    await prompt.focus()
    const readTerminal = () => terminal.evaluate((element) => element.pigcodeTerminal?.text() ?? "")
    await page.keyboard.type("echo WORKBENCH_NATIVE_OK")
    await page.keyboard.press("Enter")
    await expect.poll(readTerminal).toMatch(/\nWORKBENCH_NATIVE_OK(?:\n|$)/)
    await page.screenshot({ path: join(output, "workbench-terminal.png") })
    console.log("PASS real PTY sends command and returns output")

    await open("文件")
    await panel.getByRole("treeitem", { name: /example\.txt/ }).click()
    const editor = panel.locator(".file-view textarea")
    await expect(editor).toHaveValue("initial example\n")
    await editor.fill("changed in workbench\n")
    await panel.getByRole("button", { name: "保存", exact: true }).click()
    await expect
      .poll(() => readFile(join(root, "example.txt"), "utf8"))
      .toBe("changed in workbench\n")
    // 面板窄时打开文件后只显示文件，先切回目录导航再看装饰。
    const exampleRow = panel.getByRole("treeitem", { name: /example\.txt/ })
    if ((await exampleRow.count()) === 0) {
      await panel.getByRole("button", { name: "显示文件导航", exact: true }).click()
    }
    await expect(exampleRow).toHaveAttribute("data-git", "modified")
    await page.screenshot({ path: join(output, "workbench-files.png") })

    await panel.getByRole("treeitem", { name: ".claude", exact: true }).click()
    await expect(panel.getByRole("treeitem", { name: "worktrees", exact: true })).toHaveCount(0)
    await panel.getByRole("treeitem", { name: "settings.json", exact: true }).click()
    await expect(panel.getByText("此文件仅在完全信任此项目后生效。", { exact: true })).toBeVisible()
    await expect(editor).toHaveValue("{}\n")
    await editor.fill(savedSettings)
    await panel.getByRole("button", { name: "保存", exact: true }).click()
    await expect.poll(() => readFile(settings, "utf8")).toBe(savedSettings)
    await page.screenshot({ path: join(output, "workbench-project-settings.png") })

    await writeFile(join(root, "added.txt"), "new untracked file\n")
    await open("Diff")
    await expect(
      panel.locator(".workbench-diff").getByText("changed in workbench", { exact: true }),
    ).toBeVisible()
    await expect(
      panel.locator(".workbench-diff").getByText("new untracked file", { exact: true }),
    ).toBeVisible()
    await expect(
      panel.locator(".workbench-diff").getByText(/WORKBENCH_PROJECT_SETTINGS/),
    ).toBeVisible()
    await expect(panel.locator(".workbench-diff").getByText(/protected worktree file/)).toHaveCount(
      0,
    )
    await page.screenshot({ path: join(output, "workbench-diff.png") })
    console.log("PASS file editing, Git decorations and tracked/untracked Git diff")

    await open("检查点")
    await panel.getByRole("button", { name: "创建检查点", exact: true }).click()
    await expect(panel.getByText("手动", { exact: true })).toBeVisible()
    const checkpoint = await page.evaluate(
      async (root) => (await window.pigclaude.workbench.checkpoints(root)).at(-1),
      root,
    )
    assert.ok(checkpoint?.id)
    await writeFile(join(root, "example.txt"), "changed after checkpoint\n")
    await writeFile(join(root, "after-checkpoint.txt"), "created after checkpoint\n")
    await writeFile(settings, "{}\n")
    await writeFile(worktreeFile, "worktree changes after checkpoint\n")
    await panel.getByRole("button", { name: "恢复", exact: true }).click()
    await panel.getByRole("button", { name: "确认恢复", exact: true }).click()
    // 恢复时 Git 先删后写文件，途中读可能读不到；确认提示收起表示恢复已经结束。
    await expect(panel.getByText("文件会恢复到这个检查点", { exact: false })).toHaveCount(0)
    assert.equal(await readFile(join(root, "example.txt"), "utf8"), "changed in workbench\n")
    assert.equal(await readFile(settings, "utf8"), savedSettings)
    assert.equal(await readFile(worktreeFile, "utf8"), "worktree changes after checkpoint\n")
    await expect
      .poll(() =>
        readFile(join(root, "after-checkpoint.txt"), "utf8").then(
          () => false,
          (error) => error.code === "ENOENT",
        ),
      )
      .toBe(true)
    console.log("PASS checkpoint restoration preserves project context")
    console.log(
      "PASS project settings disclose trust, appear in Diff, and restore from checkpoints",
    )

    await open("浏览器")
    const address = panel.getByRole("textbox", { name: /输入网址/ })
    await address.fill(local)
    await address.press("Enter")
    await expect(panel.getByRole("tab", { name: "Workbench preview" })).toBeVisible()
    const inspectGuest = () =>
      application.evaluate(({ BrowserWindow }, origin) => {
        const view = BrowserWindow.getAllWindows()
          .flatMap((item) => item.contentView.children)
          .find((item) => item.webContents?.getURL().startsWith(origin + "/"))
        return { id: view?.webContents?.id, size: view?.getBounds() }
      }, local)
    await expect.poll(async () => (await inspectGuest()).size?.width ?? 0).toBeGreaterThan(0)
    const guest = await inspectGuest()
    assert.ok(guest.id && guest.size?.width > 0)
    assert.deepEqual(
      await application.evaluate(async ({ webContents }, id) => {
        const contents = webContents.fromId(id)
        return contents.executeJavaScript(
          "[typeof window.pigclaude, typeof require, document.querySelector('h1').textContent]",
        )
      }, guest.id),
      ["undefined", "undefined", "Local preview"],
    )
    await address.fill(local + "/next")
    await address.press("Enter")
    await expect(panel.getByRole("tab", { name: "Second preview" })).toBeVisible()
    await expect
      .poll(() =>
        application.evaluate(
          ({ webContents }, id) =>
            webContents
              .fromId(id)
              .navigationHistory.getAllEntries()
              .map((entry) => new URL(entry.url).pathname),
          guest.id,
        ),
      )
      .toEqual(["/", "/next"])
    await panel.getByRole("button", { name: "后退", exact: true }).click()
    await expect(panel.getByRole("tab", { name: "Workbench preview" })).toBeVisible()
    await page.screenshot({ path: join(output, "workbench-browser.png") })
    await panel.getByRole("tab", { name: "终端 1" }).click()
    await expect.poll(readTerminal).toContain("WORKBENCH_NATIVE_OK")
    console.log("PASS isolated Chromium navigation, back and terminal tab persistence")

    if (provider) await verifyProviderWorkspace(page, panel, open, root, local)
    await page.evaluate(async () => {
      const { sessionId } = await window.pigclaude.session.status()
      if (sessionId !== null) await window.pigclaude.session.stop({ sessionId })
    })
    await open("PR")
    await expect(panel.getByText(/没有指向 GitHub 的远程仓库/)).toBeVisible()
    await open("文件")
    await expect(panel.getByRole("combobox", { name: "工作树", exact: true })).toBeVisible()
    await panel.getByRole("button", { name: "切换右侧面板", exact: true }).click()
    await expect(panel).toBeHidden()
  } catch (error) {
    failure = error
    throw error
  } finally {
    await new Promise((resolve) => {
      site.close(resolve)
      site.closeAllConnections()
    })
    try {
      if (!page.isClosed()) {
        await page.evaluate(async () => {
          const bridge = window.pigclaude.workbench
          const ids = [...document.querySelectorAll("[data-workbench-terminal]")].map((element) =>
            element.getAttribute("data-workbench-terminal"),
          )
          await Promise.all(ids.filter(Boolean).map((id) => bridge.terminalClose(id)))
        })
      }
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    } catch (cleanupError) {
      if (!failure) throw cleanupError
      console.error("Workbench fixture cleanup also failed", cleanupError.code ?? cleanupError.name)
    }
  }
}

async function verifyProviderWorkspace(page, panel, open, root, local) {
  await open("Diff")
  const composer = page.locator(".composer-editor [contenteditable=true]")
  async function send(text) {
    await composer.fill(text)
    await page.getByRole("button", { name: "发送", exact: true }).click()
  }
  await send(
    "Use the Write tool to create ai-workbench.txt in this project with exactly AI_WORKBENCH_OK and a newline. Reply with exactly AI_DONE after writing the file.",
  )
  const allow = page.getByRole("option", { name: /^允许一次/ })
  await allow.press("Enter", { timeout: 45_000 })
  await expect
    .poll(() => readFile(join(root, "ai-workbench.txt"), "utf8").catch(() => ""), {
      timeout: 60_000,
    })
    .toContain("AI_WORKBENCH_OK")
  await expect(panel.getByText("AI_WORKBENCH_OK", { exact: true })).toBeVisible({ timeout: 60_000 })
  await expect
    .poll(() => page.evaluate(() => window.pigclaude.session.status()), { timeout: 60_000 })
    .toMatchObject({ turnId: null, model: "deepseek-v4.1-flash" })
  await expect
    .poll(() => page.evaluate((root) => window.pigclaude.workbench.checkpoints(root), root))
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "baseline" }),
        expect.objectContaining({ phase: "final" }),
      ]),
    )
  console.log("PASS provider writes file, captures checkpoints and automatically refreshes Diff")
  await expect(page.getByText("AI_DONE", { exact: true })).toBeVisible({ timeout: 45_000 })
  const changes = page.locator(".file-summary-head").last()
  await changes.click()
  await page.getByRole("button", { name: /在文件面板中打开 .*ai-workbench\.txt/ }).click()
  await expect(panel.locator(".file-view textarea:visible")).toHaveValue(/AI_WORKBENCH_OK/)
  await page
    .locator(".file-summary")
    .last()
    .getByRole("button", { name: "审查", exact: true })
    .click()
  await expect(
    panel.locator(".workbench-diff").getByText("AI_WORKBENCH_OK", { exact: true }),
  ).toBeVisible()
  await send(
    "Call the mcp__pigclaude_workbench__browser_open tool once on " +
      local +
      " and report the heading you read. Do not use Bash or WebFetch.",
  )
  await allow.press("Enter", { timeout: 45_000 })
  await expect(panel.getByRole("tab", { name: "Workbench preview", selected: true })).toBeVisible({
    timeout: 45_000,
  })
  await expect
    .poll(() => page.evaluate(() => window.pigclaude.session.status()), { timeout: 60_000 })
    .toMatchObject({ turnId: null, model: "deepseek-v4.1-flash" })
  await expect(
    page
      .locator(".panel")
      .getByText(/Local preview/)
      .last(),
  ).toBeVisible()
  console.log("PASS provider opens a local browser preview after explicit permission")
}
