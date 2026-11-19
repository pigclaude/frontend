// 在同一个最终 AppImage 内核对 OAuth 文件恢复和能力插件执行。
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, closeSync, openSync } from "node:fs";
import {
  mkdir,
  readFile,
  readlink,
  realpath,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { startMembershipFixture } from "./installed-membership-fixture.mjs";
import { verifyPackagedPlugin } from "./verify-packaged-plugin.mjs";

const execute = promisify(execFile);
const root = process.env.QA_ROOT;
const output = process.env.QA_OUTPUT;
const image = await realpath(process.env.QA_IMAGE);
const entry = join(
  process.env.XDG_DATA_HOME,
  "applications",
  "pigclaude-appimage.desktop",
);
const type = "x-scheme-handler/pigclaude";
const coldCallback =
  "pigclaude://authorize/callback?code=cold-fixture&state=cold-fixture";
const logPath = join(root, "programs.log");
const log = openSync(logPath, "a");
const result = {
  sourceTree: (await readFile(process.env.QA_BUILD_COMMIT, "utf8")).trim(),
  frontendBase: (await readFile(process.env.QA_FRONTEND_BASE, "utf8")).trim(),
  release: "desktop-v0.0.1-test.15",
  artifactRun: Number(process.env.QA_BUILD_RUN),
  version: "0.0.1",
  os: (await readFile("/etc/os-release", "utf8")).match(
    /^PRETTY_NAME="(.+)"$/m,
  )?.[1],
  arch: process.arch,
  checks: [],
};
const fixture = await startMembershipFixture(true);
const chromeProfile = join(root, "chrome");
const env = {
  ...process.env,
  CHROME_USER_DATA_DIR: chromeProfile,
  PIGCLAUDE_USER_DATA: join(root, "profile"),
  PIGCLAUDE_RUST_BASE_URL: fixture.origin,
  PIGCLAUDE_AUTH_ORIGIN: fixture.origin,
  PIGCLAUDE_UPDATE_CHECK: "0",
};
const run = (command, args) => execute(command, args, { env, timeout: 10_000 });
const start = (command, args) => {
  const child = spawn(command, args, { env, stdio: ["ignore", log, log] });
  child.unref();
  return child;
};
const policyPath =
  "/etc/opt/chrome/policies/managed/pigclaude-appimage-qa.json";
let appBrowser;
let chrome;
let chromeProcess;
let directProcess;
let appPid;
let stage = "";
const begin = (name) => {
  stage = name;
  console.log("CHECK", name);
};
const pass = (name) => {
  result.checks.push(name);
  console.log("PASS", name);
};
const safe = (value) =>
  String(value).replace(
    /(?:pigclaude:\/\/|https?:\/\/|wss?:\/\/)[^\s"')]+/g,
    "[URL]",
  );

async function freePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

async function connectBrowser(port) {
  const origin = "http://127.0.0.1:" + port;
  await expect
    .poll(
      async () => {
        const status = await fetch(origin + "/json/version", {
          signal: AbortSignal.timeout(1000),
        }).catch(() => null);
        return status?.ok ?? false;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  return chromium.connectOverCDP(origin);
}

const signIn = (page) =>
  page.getByRole("button", { name: /^(登录|Sign in|Log in)$/i });
const membership = (page) =>
  page.evaluate(
    async () => (await window.pigclaude.membership.inspect()).state,
  );

async function nativeWindow() {
  const id = await run("xdotool", [
    "search",
    "--onlyvisible",
    "--limit",
    "1",
    "--name",
    "^PigClaude$",
  ])
    .then(({ stdout }) => stdout.trim())
    .catch(() => "");
  if (!id) return null;
  const { stdout } = await run("xdotool", ["getwindowpid", id]);
  return { id, pid: Number(stdout.trim()) };
}

async function assertMounted(pid) {
  const path = "/proc/" + pid + "/exe";
  const executable = await readlink(path).catch(async () =>
    (await run("sudo", ["-n", "readlink", path])).stdout.trim(),
  );
  const mount = await run("findmnt", [
    "-n",
    "-o",
    "FSTYPE,SOURCE",
    "--target",
    dirname(executable),
  ]);
  assert.match(mount.stdout.trim(), /^fuse[.\s]/);
  return mount.stdout.trim();
}

async function alive(pid) {
  const procStat = await readFile("/proc/" + pid + "/stat", "utf8").catch(
    () => "",
  );
  return Boolean(procStat && !procStat.includes(") Z "));
}

async function mountDirectly() {
  const port = await freePort();
  directProcess = start(image, [
    "--remote-debugging-port=" + port,
    "--remote-debugging-address=127.0.0.1",
  ]);
  try {
    const activePort = join(env.PIGCLAUDE_USER_DATA, "DevToolsActivePort");
    await expect
      .poll(
        async () => {
          const content = await readFile(activePort, "utf8").catch(() => "");
          return content.startsWith(String(port) + "\n");
        },
        { timeout: 35_000 },
      )
      .toBe(true);
    const urlPath = (await readFile(activePort, "utf8")).trim().split("\n")[1];
    const endpoint = "ws://127.0.0.1:" + port + urlPath;
    appBrowser = await chromium.connectOverCDP(endpoint, { timeout: 35_000 });
  } catch (error) {
    const diagnostic = await run("sudo", [
      "-n",
      "ss",
      "-ltnp",
      "sport",
      "=",
      ":" + port,
    ]);
    const windowFound = await nativeWindow().catch(() => null);
    result.restartDiagnostics = {
      portListening: diagnostic.stdout.includes("LISTEN"),
      visibleWindow: windowFound !== null,
    };
    const processMatch = diagnostic.stdout.match(/pid=(\d+)/);
    if (processMatch) {
      const traced = await run("sudo", [
        "-n",
        "timeout",
        "3s",
        "strace",
        "-p",
        processMatch[1],
        "-qq",
        "-e",
        "trace=futex,poll,ppoll,epoll_wait,recvmsg,connect",
      ]).catch((error) => ({ stderr: error.stderr ?? "" }));
      await writeFile(
        join(output, "startup-waits.txt"),
        (traced.stderr ?? "").slice(0, 3000),
      );
    }
    await writeFile(
      join(output, "app-debug-port.txt"),
      diagnostic.stdout.replaceAll(String(port), "PORT"),
    );
    throw error;
  }
  const context = appBrowser.contexts()[0];
  const page =
    context.pages()[0] ??
    (await context.waitForEvent("page", { timeout: 15_000 }));
  page.setDefaultTimeout(15_000);
  await page.waitForFunction(() => !!window.pigclaude?.membership);
  const session = await appBrowser.newBrowserCDPSession();
  const processes = await session.send("SystemInfo.getProcessInfo");
  appPid = processes.processInfo.find(({ type }) => type === "browser")?.id;
  await session.detach();
  assert(appPid);
  return page;
}

async function closeApp(page) {
  await page
    .evaluate(async () => {
      await window.pigclaude.window.setCloseToTray(false);
      await window.pigclaude.window.control("close");
    })
    .catch(() => {});
  await expect.poll(() => alive(appPid), { timeout: 15_000 }).toBe(false);
  await appBrowser.close().catch(() => {});
  await expect
    .poll(() => alive(directProcess.pid), { timeout: 15_000 })
    .toBe(false);
  appBrowser = undefined;
  appPid = undefined;
  directProcess = undefined;
}

async function openUri(url) {
  const child = start("gio", ["open", url]);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("GIO URI dispatch timed out"));
    }, 8_000);
    child.once("exit", (code) => {
      clearTimeout(timeout);
      resolve(code);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function defaultHandler() {
  const { stdout } = await execute("gio", ["mime", type], {
    env: { ...env, LC_ALL: "C" },
    timeout: 10_000,
  });
  const firstLine = stdout.split("\n")[0];
  return firstLine.match(/^Default application for .+: (.+)$/)?.[1] ?? "";
}

async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

try {
  begin("clean profile and exact build artifact");
  result.sha256 = await sha256(process.env.QA_CANDIDATE);
  assert.equal(result.sha256, process.env.QA_EXPECTED_SHA);
  assert.equal(await sha256(image), result.sha256);
  assert.equal(await defaultHandler(), "");
  assert.equal(
    await stat(entry).then(
      () => true,
      () => false,
    ),
    false,
  );
  result.cleanDispatchExit = await openUri(coldCallback);
  assert.equal(result.cleanDispatchExit, 2);
  const readAppArmor = () =>
    readFile(
      "/proc/sys/kernel/apparmor_restrict_unprivileged_userns",
      "utf8",
    ).then((value) => value.trim());
  result.apparmorBeforeLaunch = await readAppArmor();
  assert.equal(result.apparmorBeforeLaunch, "1");
  pass(
    "fresh XDG profile cannot open the private URL before the first app launch",
  );

  begin("first direct launch registers an AppImage desktop entry");
  const first = await mountDirectly();
  const firstPid = appPid;
  await expect(signIn(first)).toBeVisible();
  const entryText = await readFile(entry, "utf8");
  assert.match(entryText, /^MimeType=x-scheme-handler\/pigclaude;$/m);
  assert(entryText.includes("PigClaude 100%%=stable.AppImage"));
  assert(!entryText.includes("/.mount_"));
  assert(!entryText.includes("--no-sandbox"));
  assert.equal(await defaultHandler(), "pigclaude-appimage.desktop");
  result.handler = await defaultHandler();
  result.fuse = await assertMounted(firstPid);
  const entryMtime = (await stat(entry)).mtimeMs;
  await first.screenshot({ path: join(output, "first-launch.png") });
  pass(
    "AppImage generated the persistent entry and set the default as the current user",
  );
  assert.match(result.sourceTree, /^[0-9a-f]{40}$/);

  begin("launch real Chrome and complete authorization from the page");
  // 只为这台一次性运行器的回环测试页面预先确认外部协议提示。
  const policyFile = join(root, "chrome-policy.json");
  await writeFile(
    policyFile,
    JSON.stringify({
      AutoLaunchProtocolsFromOrigins: [
        { protocol: "pigclaude", allowed_origins: [fixture.origin] },
      ],
    }),
  );
  await run("sudo", [
    "-n",
    "install",
    "-D",
    "-m",
    "0644",
    policyFile,
    policyPath,
  ]);
  await run("xdg-settings", [
    "set",
    "default-web-browser",
    "google-chrome.desktop",
  ]);
  const chromePort = await freePort();
  chromeProcess = start("google-chrome", [
    "--remote-debugging-port=" + chromePort,
    "--remote-debugging-address=127.0.0.1",
    "--user-data-dir=" + chromeProfile,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "about:blank",
  ]);
  chrome = await connectBrowser(chromePort);
  const app = first;
  const activePid = appPid;
  await signIn(app).click();
  await expect(
    app.getByRole("button", { name: /^(复制链接|Copy link)$/i }),
  ).toBeEnabled();
  const chromeContext = chrome.contexts()[0];
  const isAuthorization = (page) =>
    page.url().startsWith(fixture.origin + "/oauth2/authorize?");
  await expect
    .poll(() => chromeContext.pages().some(isAuthorization), {
      timeout: 25_000,
    })
    .toBe(true);
  const website = chromeContext.pages().find(isAuthorization);
  assert(website);
  assert.equal(fixture.state().browserVisits, 1);
  await website.getByRole("link", { name: "Send wrong state" }).click();
  await delay(750);
  assert.equal(fixture.state().exchangeAttempts, 0);
  await website.getByRole("link", { name: "Approve device" }).click();
  await expect.poll(() => membership(app), { timeout: 20_000 }).toBe("active");
  await website.getByRole("link", { name: "Approve device" }).click();
  await delay(750);
  assert.equal(fixture.state().exchangeAttempts, 1);
  assert.equal(fixture.state().exchanges, 1);
  assert(await alive(activePid));
  assert.equal(await defaultHandler(), result.handler);
  result.browser = (await run("google-chrome", ["--version"])).stdout.trim();
  result.exchangeAttempts = fixture.state().exchangeAttempts;
  const skip = app.getByRole("button", {
    name: /^(稍后再说|Maybe later|Skip for now)$/i,
  });
  if (await skip.isVisible()) await skip.click();
  await app.screenshot({
    path: join(output, "after-browser-authorization.png"),
  });
  pass(
    "Chrome opened the real system protocol from the fixture page and the running instance exchanged once",
  );
  begin("run installed plugin with AppArmor and capture sandbox flags");
  const proc = (name) =>
    run("sudo", ["-n", "cat", "/proc/" + appPid + "/" + name]).then(
      ({ stdout }) => stdout,
    );
  const flags =
    (await proc("cmdline")).match(
      /--(?:no-sandbox|disable-seccomp-filter-sandbox|disable-namespace-sandbox)(?=[\x00\s=]|$)/g,
    ) ?? [];
  result.appSandbox = {
    flags,
    disablesSandboxViaEnvironment: (await proc("environ"))
      .split("\0")
      .some((item) => /^ELECTRON_DISABLE_SANDBOX=.+/.test(item)),
    unshareAllowed: await run("unshare", ["-Ur", "true"]).then(
      () => true,
      () => false,
    ),
  };
  console.log("SANDBOX", JSON.stringify(result.appSandbox));
  assert.deepEqual(flags, []);
  assert.equal(result.appSandbox.disablesSandboxViaEnvironment, false);
  assert.equal(result.appSandbox.unshareAllowed, false);
  const appFile = await run("sudo", [
    "-n",
    "readlink",
    "/proc/" + appPid + "/exe",
  ]).then((result) => result.stdout.trim());
  const link = dirname(appFile) + "/chrome-sandbox";
  assert.equal(await readlink(link), "/opt/google/chrome/chrome-sandbox");
  const helper = await stat(link);
  assert.equal(helper.uid, 0);
  assert.equal(helper.mode & 0o4777, 0o4755);
  result.systemSuidHelper = true;
  const matched = await run("ps", [
    "-o",
    "pid=,args=",
    "--ppid",
    String(appPid),
  ]).then(({ stdout }) => stdout.split("\n"));
  result.childSandboxArgv = matched.flatMap(
    (line) =>
      line.match(
        /--(?:type|no-sandbox|disable-seccomp-filter-sandbox|disable-namespace-sandbox)\S*/g,
      ) ?? [],
  );
  result.plugin = await verifyPackagedPlugin(app, root);
  pass("synthetic archive command executed in the installed sandbox");
  result.claudeAccounts = await app.evaluate(
    async () => (await window.pigclaude.claudeAccounts.list()).length,
  );
  assert.equal(result.claudeAccounts, 0);
  const authorization = await app.evaluate(async () => {
    const view = await window.pigclaude.membership.inspect();
    return {
      state: view.state,
      userId: view.account?.userId,
      bindingEpoch: view.bindingEpoch,
    };
  });
  assert.equal(authorization.state, "active");
  const oauthPath = join(env.PIGCLAUDE_USER_DATA, "oauth-session.json");
  const saved = JSON.parse(await readFile(oauthPath, "utf8"));
  assert.equal(saved.userId, authorization.userId);
  assert.equal(saved.bindingEpoch, authorization.bindingEpoch);
  assert(saved.accessToken && saved.refreshToken);
  assert.equal((await stat(oauthPath)).mode & 0o777, 0o600);
  const oauthSha = await sha256(oauthPath);
  result.oauthFile = "oauth-session.json";
  result.oauthMode = "0600";
  pass(
    "the same installed sandbox-enabled build saves the device grant in the OAuth file",
  );

  begin("complete exit and cold-start with the saved device authorization");
  const beforeExit = appPid;
  await closeApp(app);
  const beforeCold = fixture.state().entitlementReads;
  assert.equal(await nativeWindow(), null);
  assert.equal(await openUri(coldCallback), 0);
  await expect.poll(() => nativeWindow(), { timeout: 50_000 }).not.toBeNull();
  appPid = (await nativeWindow()).pid;
  assert.notEqual(appPid, beforeExit);
  result.coldMount = await assertMounted(appPid);
  await expect
    .poll(() => fixture.state().entitlementReads, { timeout: 30000 })
    .toBeGreaterThan(beforeCold);
  assert.equal(fixture.state().exchangeAttempts, 1);
  assert.equal(await sha256(oauthPath), oauthSha);
  result.oauthRestoredOnColdStart = true;
  result.oauthFileUnchanged = true;
  result.apparmorAfterColdStart = (
    await readFile(
      "/proc/sys/kernel/apparmor_restrict_unprivileged_userns",
      "utf8",
    )
  ).trim();
  assert.equal(result.apparmorAfterColdStart, "1");
  result.coldStarted = true;
  pass(
    "GIO cold-launched the same AppImage and restored the original authorization",
  );
} catch (error) {
  result.failure = {
    stage,
    message: safe(error.stack ?? error).slice(0, 2300),
  };
  console.error(result.failure);
  process.exitCode = 1;
} finally {
  if (appPid && (await alive(appPid))) process.kill(appPid, "SIGTERM");
  if (directProcess?.exitCode == null) directProcess?.kill();
  if (chromeProcess?.exitCode == null) chromeProcess?.kill();
  await appBrowser?.close().catch(() => {});
  await chrome?.close().catch(() => {});
  await fixture.close();
  await run("sudo", ["-n", "rm", "-f", policyPath]).catch(() => {});
  closeSync(log);
  const logs = safe((await readFile(logPath, "utf8")).slice(-20_000));
  await writeFile(join(output, "appimage.log"), logs);
  if (result.failure) console.log(logs);
  await writeFile(
    join(output, "verified.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  await new Promise((resolve) =>
    process.stdout.write(JSON.stringify(result, null, 2) + "\n", resolve),
  );
  process.exit(process.exitCode ?? 0);
}
