// 用草稿 AppImage 和独立文件版对照包验证 OAuth 授权、重启及替换。
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, closeSync, openSync } from "node:fs";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readlink,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { chromium, expect } from "@playwright/test";
import { startMembershipFixture } from "./installed-membership-fixture.mjs";

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
  buildCommit: (await readFile(process.env.QA_BUILD_COMMIT, "utf8")).trim(),
  buildRun: Number(process.env.QA_BUILD_RUN),
  release: "desktop-v0.0.1-test.14",
  alternatePackage: "独立构建的 OAuth 文件版 AppImage",
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
  const portFile = join(env.PIGCLAUDE_USER_DATA, "DevToolsActivePort");
  await rename(portFile, portFile + ".previous").catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  directProcess = start(image, [
    "--remote-debugging-port=0",
    "--remote-debugging-address=127.0.0.1",
  ]);
  let lastError;
  let lastPort;
  await expect
    .poll(
      async () => {
        const data = await readFile(portFile, "utf8").catch(() => "");
        if (!data) return false;
        const [port, endpoint] = data.trim().split("\n");
        if (!endpoint?.startsWith("/devtools/browser/")) return false;
        lastPort = port;
        try {
          appBrowser = await chromium.connectOverCDP(
            "ws://127.0.0.1:" + port + endpoint,
            { timeout: 4000 },
          );
          return true;
        } catch (error) {
          lastError = safe(error.message).split("\n")[0];
          return false;
        }
      },
      { timeout: 35_000 },
    )
    .toBe(true)
    .catch(async (error) => {
      const visible = await nativeWindow().catch(() => null);
      const listening = lastPort
        ? await run("sudo", [
            "-n",
            "ss",
            "-ltnp",
            "sport",
            "=",
            ":" + lastPort,
          ]).catch(() => null)
        : null;
      result.restartDiagnostic = {
        visibleWindow: visible !== null,
        portListening: Boolean(listening?.stdout.includes("LISTEN")),
        lastError,
      };
      if (visible) appPid = visible.pid;
      throw error;
    });
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
  result.baselineSha256 = await sha256(process.env.QA_ALTERNATE);
  assert.equal(result.baselineSha256, process.env.QA_ALTERNATE_SHA);
  result.sha256 = await sha256(process.env.QA_CANDIDATE);
  assert.equal(result.sha256, process.env.QA_EXPECTED_SHA);
  assert.equal(await sha256(image), result.sha256);
  assert.notEqual(result.baselineSha256, result.sha256);
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

  pass(
    "fresh XDG profile cannot open the private URL before the first app launch",
  );

  begin("first direct launch registers an AppImage desktop entry");
  const profile = env.PIGCLAUDE_USER_DATA;
  const authFile = join(profile, "oauth-session.json");
  const legacyFile = join(profile, "authorization-secrets.json");
  await mkdir(profile, { recursive: true, mode: 0o700 });
  await writeFile(legacyFile, "旧格式夹具", { flag: "wx", mode: 0o600 });
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
  assert.equal(result.buildCommit, process.env.QA_EXPECTED_COMMIT);

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
  begin("persist membership, update settings and the XDG autostart entry");
  const snapshot = (page) =>
    page.evaluate(async () => {
      const bridge = window.pigclaude;
      const member = await bridge.membership.inspect();
      return {
        state: member.state,
        userId: member.account?.userId,
        epoch: member.bindingEpoch,
        autoCheck: (await bridge.updates.state()).autoCheck,
        startAtLogin: (await bridge.startupPreferences.get()).openAtLogin,
        closeToTray: await bridge.window.getCloseToTray(),
      };
    });
  await app.evaluate(async () => {
    const bridge = window.pigclaude;
    await bridge.updates.setAutoCheck(false);
    await bridge.startupPreferences.set("openAtLogin", true);
    await bridge.window.setCloseToTray(false);
  });
  const before = await snapshot(app);
  assert.equal(before.state, "active");
  assert(before.userId && before.epoch && before.startAtLogin);
  assert.equal(before.autoCheck, false);
  const autostart = join(
    process.env.XDG_CONFIG_HOME,
    "autostart",
    "pigclaude-autostart.desktop",
  );
  const savedEntry = await readFile(entry, "utf8");
  const savedAutostart = await readFile(autostart, "utf8");
  assert(savedAutostart.includes("PigClaude 100%%=stable.AppImage"));
  assert(savedAutostart.includes("--pigclaude-autostart"));
  const grant = JSON.parse(await readFile(authFile, "utf8"));
  assert.equal(grant.userId, before.userId);
  assert.equal(grant.bindingEpoch, before.epoch);
  assert(grant.accessToken && grant.refreshToken);
  assert.equal((await stat(authFile)).mode & 0o777, 0o600);
  const oathHash = await sha256(authFile);
  result.oauthFile = "oauth-session.json";
  result.oauthMode = "0600";
  assert.equal(await readFile(legacyFile, "utf8"), "旧格式夹具");
  assert.equal(
    await app.evaluate(
      async () => (await window.pigclaude.claudeAccounts.list()).length,
    ),
    0,
  );
  await closeApp(app);

  async function startSaved(previousPid) {
    assert.equal(await nativeWindow(), null);
    const prior = fixture.state().entitlementReads;
    directProcess = start(image, []);
    await expect.poll(() => nativeWindow(), { timeout: 60000 }).not.toBeNull();
    const window = await nativeWindow();
    appPid = window.pid;
    assert.notEqual(appPid, previousPid);
    await assertMounted(appPid);
    await expect
      .poll(() => fixture.state().entitlementReads, { timeout: 30000 })
      .toBeGreaterThan(prior);
    assert.equal(fixture.state().exchangeAttempts, 1);
    assert.equal(await sha256(authFile), oathHash);
    assert.equal(await readFile(legacyFile, "utf8"), "旧格式夹具");
    assert.equal(await readFile(entry, "utf8"), savedEntry);
    assert.equal(await readFile(autostart, "utf8"), savedAutostart);
    return window;
  }

  async function stopSaved(window) {
    await run("xdotool", ["windowactivate", "--sync", window.id]);
    await run("xdotool", ["key", "alt+F4"]);
    await expect.poll(() => alive(window.pid), { timeout: 20000 }).toBe(false);
    if (directProcess)
      await expect
        .poll(() => alive(directProcess.pid), { timeout: 15000 })
        .toBe(false);
    appPid = undefined;
    directProcess = undefined;
  }

  async function replaceWith(path, checksum) {
    await copyFile(path, image + ".new");
    await chmod(image + ".new", 0o755);
    await rename(image + ".new", image);
    assert.equal(await sha256(image), checksum);
  }

  begin("restart the same test.14 AppImage with its saved OAuth file");
  const restarted = await startSaved(firstPid);
  await stopSaved(restarted);
  result.sameInstallerRestart = true;
  pass("test.14 restarts and uses the original granted credential");

  begin("replace the actual bytes with a distinct file-storage AppImage");
  await replaceWith(process.env.QA_ALTERNATE, result.baselineSha256);
  const alternate = await startSaved(restarted.pid);
  await stopSaved(alternate);
  result.alternateRestored = true;
  pass(
    "the alternate installer loads the same OAuth file at the original path",
  );

  begin("restore the original test.14 AppImage at the same path");
  await replaceWith(process.env.QA_CANDIDATE, result.sha256);
  const updated = await startSaved(alternate.pid);
  const updatedPid = updated.pid;
  result.test14RestoredAfterReplacement = true;
  result.oauthBytesIdentical = true;
  result.legacyFixtureUnchanged = true;
  result.claudeAccounts = 0;
  await stopSaved(updated);
  pass(
    "the exact test.14 installer preserves the original OAuth file after replacement",
  );

  begin("protocol cold start with the application stopped");
  assert.equal(await nativeWindow(), null);
  const beforeCold = fixture.state().entitlementReads;
  result.coldDispatchExit = await openUri(coldCallback);
  assert.equal(result.coldDispatchExit, 0);
  await expect.poll(() => nativeWindow(), { timeout: 60_000 }).not.toBeNull();
  const coldWindow = await nativeWindow();
  appPid = coldWindow.pid;
  assert.notEqual(appPid, updatedPid);
  await expect
    .poll(() => fixture.state().entitlementReads, { timeout: 25_000 })
    .toBeGreaterThan(beforeCold);
  result.coldUsedSameCredential = true;
  await assertMounted(appPid);
  assert.equal((await stat(entry)).mtimeMs, entryMtime);
  assert.equal(fixture.state().exchangeAttempts, 1);
  result.apparmorAfterColdStart = await readAppArmor();
  assert.equal(result.apparmorAfterColdStart, result.apparmorBeforeLaunch);
  result.coldStarted = true;
  pass(
    "GIO cold-launched the same AppImage without any installed test launcher",
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
