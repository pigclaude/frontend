// 用隔离 OAuth 服务验证设备令牌文件在两个临时签名 DMG 间复用。
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, openSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
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

const run = promisify(execFile);
const root = await mkdtemp(join(process.env.QA_ROOT, "mac-oauth-live."));
const path = join(root, "Applications", "PigClaude.app");
const executable = join(path, "Contents", "MacOS", "PigClaude");
const profile = join(root, "product-data");
const fixture = await startMembershipFixture(true);
const env = {
  ...process.env,
  PIGCLAUDE_USER_DATA: profile,
  PIGCLAUDE_RUST_BASE_URL: fixture.origin,
  PIGCLAUDE_AUTH_ORIGIN: fixture.origin,
  PIGCLAUDE_UPDATE_CHECK: "0",
};
const result = {
  release: "desktop-v0.0.1-test.14",
  frontendCommit: process.env.QA_BUILD_SHA,
  architecture: process.arch,
  tests: [],
  appVersion: "0.0.1",
  syntheticAccount: true,
  claudeAccountUsed: false,
};
const log = openSync(join(root, "observations.log"), "a");
let current;
let step = "prepare";
const begin = (label) => {
  step = label;
  console.log("CHECK", label);
};
const pass = (test) => {
  result.tests.push(test);
  console.log("PASS", test);
};
const quiet = (message) =>
  String(message).replace(/(?:https?|wss?|pigclaude):\/\/[^\s"'\)]+/g, "[URL]");

async function hash(path) {
  const digest = createHash("sha256");
  for await (const bytes of createReadStream(path)) digest.update(bytes);
  return digest.digest("hex");
}

async function install(dmg, destination) {
  const volume = await mkdtemp(join(root, "dmg."));
  await mkdir(dirname(destination), { recursive: true });
  await run(
    "/usr/bin/hdiutil",
    ["attach", "-readonly", "-nobrowse", "-mountpoint", volume, dmg],
    { timeout: 20000 },
  );
  try {
    await run("/usr/bin/ditto", [join(volume, "PigClaude.app"), destination], {
      timeout: 30000,
    });
    await run(
      "/usr/bin/codesign",
      ["--verify", "--deep", "--strict", destination],
      { timeout: 15000 },
    );
  } finally {
    await run("/usr/bin/hdiutil", ["detach", volume], { timeout: 10000 }).catch(
      () =>
        run("/usr/bin/hdiutil", ["detach", "-force", volume], {
          timeout: 10000,
        }),
    );
  }
}

async function port() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const result = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return result;
}

async function launch() {
  const selected = await port();
  const app = spawn(
    executable,
    [
      "--remote-debugging-port=" + selected,
      "--remote-debugging-address=127.0.0.1",
    ],
    { env, stdio: ["ignore", log, log] },
  );
  const launched = {
    app,
    since: new Date(),
    origin: "http://127.0.0.1:" + selected,
    browser: null,
    page: null,
  };
  current = launched;
  return launched;
}

async function reach(launched, timeout = 18000) {
  const started = Date.now();
  await expect
    .poll(
      async () => {
        return await fetch(launched.origin + "/json/version", {
          signal: AbortSignal.timeout(700),
        }).then(
          (r) => r.ok,
          () => false,
        );
      },
      { timeout },
    )
    .toBe(true);
  launched.browser = await chromium.connectOverCDP(launched.origin, {
    timeout: 6000,
  });
  const context = launched.browser.contexts()[0];
  launched.page =
    context.pages()[0] ??
    (await context.waitForEvent("page", { timeout: 8000 }));
  await launched.page.waitForFunction(() => !!window.pigclaude?.appInfo, null, {
    timeout: 5000,
  });
  result.lastWindowMs = Date.now() - started;
  return launched.page;
}

async function stop(launched = current) {
  if (!launched) return;
  const exited = () =>
    launched.app.exitCode !== null || launched.app.signalCode !== null;
  if (!exited() && launched.page) {
    await Promise.race([
      launched.page
        .evaluate(async () => {
          await window.pigclaude.window.setCloseToTray(false);
          await window.pigclaude.window.control("close");
        })
        .catch(() => {}),
      delay(2000),
    ]);
  }
  if (!exited()) {
    await expect
      .poll(exited, { timeout: 3000 })
      .toBe(true)
      .catch(async () => {
        launched.app.kill("SIGKILL");
        await expect.poll(exited, { timeout: 5000 }).toBe(true);
      });
  }
  await launched.browser?.close().catch(() => {});
  if (current === launched) current = null;
}

async function inspect(page) {
  return page.evaluate(async () => {
    const { state, account, bindingEpoch, errorCode } =
      await window.pigclaude.membership.inspect();
    return { state, userId: account?.userId, bindingEpoch, errorCode };
  });
}

async function keychainPrompts(launched) {
  const format = new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "short",
    timeStyle: "medium",
    hourCycle: "h23",
  }).format(launched.since);
  const target = 'eventMessage CONTAINS[c] "' + root + '"';
  const prompt =
    'process == "securityd" AND eventMessage CONTAINS[c] "displaying keychain prompt for"';
  const { stdout } = await run(
    "/usr/bin/log",
    [
      "show",
      "--start",
      format,
      "--style",
      "compact",
      "--predicate",
      prompt + " AND " + target,
    ],
    { timeout: 15000 },
  );
  return stdout
    .split("\n")
    .filter((line) => line.includes("displaying keychain prompt for")).length;
}

async function signature() {
  const { stderr } = await run(
    "/usr/bin/codesign",
    ["-d", "--verbose=4", path],
    { timeout: 15000 },
  );
  assert(stderr.includes("Signature=adhoc"));
  return stderr.match(/^CDHash=(\w+)$/m)?.[1];
}

async function verifySavedAuthorization(launched, original) {
  const page = await reach(launched);
  await expect
    .poll(async () => (await inspect(page)).state, { timeout: 12000 })
    .toBe("active");
  assert.deepEqual(await inspect(page), original);
  assert.equal(await keychainPrompts(launched), 0);
  return page;
}

try {
  result.baselineSha256 = await hash(process.env.QA_BASELINE_DMG);
  result.candidateSha256 = await hash(process.env.QA_CANDIDATE_DMG);
  assert.equal(result.candidateSha256, process.env.QA_EXPECTED_SHA);
  result.sourceTree = (
    await readFile(join(process.env.QA_ROOT, "source-tree.txt"), "utf8")
  ).trim();
  await install(process.env.QA_CANDIDATE_DMG, path);
  const baselineHash = await signature();
  assert(baselineHash);
  await mkdir(profile, { recursive: true, mode: 0o700 });
  const legacyPath = join(profile, "authorization-secrets.json");
  await writeFile(legacyPath, "不再使用的旧格式夹具", { mode: 0o600 });
  const legacyHash = await hash(legacyPath);
  const authorizationFile = join(profile, "oauth-session.json");

  begin("open the exact test.14 DMG and authorize a local synthetic member");
  const first = await launch();
  const page = await reach(first, 22000);
  await expect.poll(async () => (await inspect(page)).state).toBe("signed_out");
  assert.equal(await keychainPrompts(first), 0);
  await page
    .getByRole("button", { name: /^(登录|Sign in|Log in)$/i })
    .click({ timeout: 8000 });
  await expect
    .poll(() => fixture.state().identities.length, { timeout: 10000 })
    .toBe(1);
  const callback = fixture.nativeCallback();
  await run("/usr/bin/open", ["-g", "-a", path, callback.href], {
    timeout: 10000,
  }).catch(() => {
    throw new Error("private protocol dispatch failed");
  });
  await expect
    .poll(async () => (await inspect(page)).state, { timeout: 12000 })
    .toBe("active");
  const before = await inspect(page);
  const record = JSON.parse(await readFile(authorizationFile, "utf8"));
  assert.equal(record.userId, before.userId);
  assert.equal(record.bindingEpoch, before.bindingEpoch);
  assert(record.accessToken && record.refreshToken);
  assert.equal((await stat(authorizationFile)).mode & 0o777, 0o600);
  assert.equal(await hash(legacyPath), legacyHash);
  assert.equal(await keychainPrompts(first), 0);
  const grantHash = await hash(authorizationFile);
  result.firstAuthorization = {
    savedAs: "oauth-session.json",
    posixMode: "0600",
    keychainPrompts: 0,
  };
  pass(
    "OAuth creates a private JSON file while ignoring the old-format fixture",
  );
  await stop(first);

  begin("fully quit and restart the same DMG");
  const restarted = await launch();
  assert.notEqual(restarted.app.pid, first.app.pid);
  await verifySavedAuthorization(restarted, before);
  assert.equal(await hash(authorizationFile), grantHash);
  assert.equal(await hash(legacyPath), legacyHash);
  result.sameDmgRestart = {
    automatic: true,
    keychainPrompts: 0,
    fileBytesIdentical: true,
  };
  pass("restart automatically restores the original device authorization");
  await stop(restarted);

  begin(
    "replace the installed app with a separately signed DMG at the original path",
  );
  await rename(path, join(root, "previous-app"));
  await install(process.env.QA_BASELINE_DMG, path);
  const candidateHash = await signature();
  assert(candidateHash && candidateHash !== baselineHash);
  const updated = await launch();
  assert.notEqual(updated.app.pid, restarted.app.pid);
  const updatedPage = await verifySavedAuthorization(updated, before);
  assert.equal(await hash(authorizationFile), grantHash);
  assert.equal(await hash(legacyPath), legacyHash);
  assert.equal(fixture.state().exchangeAttempts, 1);
  assert.equal(
    await updatedPage.evaluate(
      async () => (await window.pigclaude.claudeAccounts.list()).length,
    ),
    0,
  );
  result.replacedDmg = {
    automatic: true,
    distinctAdHocCodeSignatures: true,
    keychainPrompts: 0,
    fileBytesIdentical: true,
  };
  result.sameTestMemberAndBinding = true;
  result.oldFixtureUntouched = true;
  result.exchanges = fixture.state().exchangeAttempts;
  await stop(updated);
  pass("changing DMGs keeps the same grant and never requests Keychain access");
  begin("replace the alternate bundle with the exact test.14 DMG");
  await rename(path, join(root, "alternate-app"));
  await install(process.env.QA_CANDIDATE_DMG, path);
  assert.equal(await signature(), baselineHash);
  const final = await launch();
  await verifySavedAuthorization(final, before);
  assert.equal(await hash(authorizationFile), grantHash);
  assert.equal(await hash(legacyPath), legacyHash);
  assert.equal(fixture.state().exchangeAttempts, 1);
  result.returnedToTest14 = { restored: true, keychainPrompts: 0 };
  await stop(final);
  pass(
    "the original test.14 bundle restores the original file after being installed over the alternate",
  );
} catch (error) {
  result.failure = { step, message: quiet(error.message).slice(0, 500) };
  process.exitCode = 1;
} finally {
  await stop().catch(() => {});
  await fixture.close();
  await writeFile(
    join(process.env.QA_ROOT, "mac-verified.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log(JSON.stringify(result, null, 2));
}
