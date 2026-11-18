#!/usr/bin/env bash
# 只读挂载待验 AppImage，使用安装内 CLI 验证两组语言时区并保留证据。
set -euo pipefail
umask 077
mkdir -p "$QA_ROOT" "$QA_OUTPUT"
actual=$(sha256sum "$QA_INSTALLER" | awk '{print $1}')
test "$actual" = "$QA_EXPECTED_SHA"
image="$QA_ROOT/PigClaude 100%=stable.AppImage"
install -m 0755 "$QA_INSTALLER" "$image"
"$image" --appimage-mount > "$QA_ROOT/mount-path" 2> "$QA_OUTPUT/mount-errors.txt" &
mount_pid=$!
trap 'kill "$mount_pid" 2>/dev/null || true; wait "$mount_pid" 2>/dev/null || true' EXIT
for attempt in {1..60}; do
  test -s "$QA_ROOT/mount-path" && break
  kill -0 "$mount_pid"
  sleep 0.25
done
read -r mounted < "$QA_ROOT/mount-path"
export PIGCLAUDE_TEST_INSTALLED_LINUX_RESOURCES="$mounted/resources"
export QA_ACTUAL_SHA="$actual"
export QA_FUSE="$(findmnt -n -o FSTYPE,OPTIONS --target "$mounted")"
export QA_APPARMOR="$(sysctl -n kernel.apparmor_restrict_unprivileged_userns)"
test "$QA_APPARMOR" = 1
case "$QA_FUSE" in fuse.*nosuid*) ;; *) exit 1 ;; esac
export QA_CLI_SHA="$(sha256sum "$mounted/resources/app.asar.unpacked/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude" | awk '{print $1}')"
echo "CLI SHA-256 $QA_CLI_SHA"
NO_COLOR=1 pnpm --filter @pigclaude/desktop exec vitest run src/main/session/claude-linux-locale.integration.test.ts --maxWorkers=1 | tee "$QA_OUTPUT/intl.log"
node --input-type=module <<'JS'
import assert from "node:assert/strict"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
const output = process.env.QA_OUTPUT
const profiles = readFileSync(join(output, "intl.log"), "utf8").split("\n")
  .filter((line) => line.startsWith('{"locale":')).map((line) => JSON.parse(line))
const expected = [
  ["en-US", "America/Chicago", "en_US.UTF-8"],
  ["fr-FR", "Europe/Paris", "fr_FR.UTF-8"],
]
assert.equal(profiles.length, expected.length)
for (const [index, profile] of profiles.entries()) {
  const [locale, timezone, posix] = expected[index]
  assert.equal(profile.locale, locale)
  assert.deepEqual(profile.intl.locales, Array(6).fill(locale))
  assert.deepEqual(profile.intl.localeEnv, [posix, posix])
  assert.equal(profile.intl.timezone, timezone)
  assert.equal(profile.intl.preloadAbsent, true)
  assert.equal(profile.native.protocolPreserved, true)
}
const cliManifest = JSON.parse(readFileSync("apps/desktop/node_modules/@anthropic-ai/claude-agent-sdk/manifest.json", "utf8"))
assert.equal(process.env.QA_CLI_SHA, cliManifest.platforms["linux-x64"].checksum)
const result = {
  buildCommit: process.env.QA_BUILD_SHA,
  buildRun: Number(process.env.QA_BUILD_RUN),
  sha256: process.env.QA_ACTUAL_SHA,
  os: readFileSync("/etc/os-release", "utf8").match(/^PRETTY_NAME="(.+)"$/m)?.[1],
  arch: process.arch,
  fuse: process.env.QA_FUSE,
  appArmorUserNamespaceRestriction: Number(process.env.QA_APPARMOR),
  officialCliSha256: process.env.QA_CLI_SHA,
  profiles,
}
writeFileSync(join(output, "verified.json"), JSON.stringify(result, null, 2) + "\n")
JS
