// 用本轮生成的小型插件归档验证安装包的生产沙箱和纯文本草稿命令。
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

/** 安装合成归档，在真实插件沙箱内运行命令，再停用及卸载。 */
export async function verifyPackagedPlugin(page, root) {
  const id = "sandbox-oauth-probe";
  const source = join(root, "local-plugin-source");
  const archive = join(root, id + ".tgz");
  const marker = "<b>packaged AppImage sandbox</b>";
  await mkdir(source);
  const manifest = {
    apiVersion: 1,
    id,
    name: "AppImage 沙箱测试插件",
    version: "1.0.0",
    pigclaudeVersion: "*",
    entry: "index.mjs",
    permissions: ["composer-insert"],
    commands: [{ id: "probe", title: "AppImage 沙箱探针" }],
  };
  const script = [
    "export default async (operation, _input, api) => {",
    'if(operation !== "command:probe") throw Error("wrong operation")',
    'if(typeof require !== "undefined" || typeof process !== "undefined" || typeof window !== "undefined") throw Error("unexpected host globals")',
    "await api.composer.insert(" + JSON.stringify(marker) + ")",
    "}",
  ].join("\n");
  await writeFile(
    join(source, "pigclaude-plugin.json"),
    JSON.stringify(manifest),
  );
  await writeFile(join(source, "index.mjs"), script);
  await promisify(execFile)("tar", [
    "-czf",
    archive,
    "-C",
    source,
    "pigclaude-plugin.json",
    "index.mjs",
  ]);
  const sha256 = createHash("sha256")
    .update(await readFile(archive))
    .digest("hex");
  const facts = await page.evaluate(
    async ({ id, source, archive, sha256 }) => {
      const plugins = window.pigclaude.capabilityPlugins;
      const { developerMode } = await plugins.status();
      const localDirectoryBlocked = await plugins
        .prepare({ kind: "directory", path: source })
        .then(
          () => false,
          (error) =>
            String(error.message).includes("PLUGIN_DEVELOPER_MODE_REQUIRED"),
        );
      const wrongDigestBlocked = await plugins
        .prepare({ kind: "archive", path: archive, sha256: "0".repeat(64) })
        .then(
          () => false,
          (error) =>
            String(error.message).includes("PLUGIN_ARCHIVE_SHA256_MISMATCH"),
        );
      const disclosure = await plugins.prepare({
        kind: "archive",
        path: archive,
        sha256,
      });
      const installed = await plugins.confirm(disclosure.confirmationId);
      try {
        const { revision } = await plugins.setEnabled(id, true);
        const output = await plugins.runCommand(
          { pluginId: id, revision },
          "probe",
        );
        const stopped = await plugins.setEnabled(id, false);
        return {
          developerMode,
          localDirectoryBlocked,
          wrongDigestBlocked,
          installed: installed.manifest.id === id,
          insertText: output.insertText,
          disabled: stopped.enabled === false,
        };
      } finally {
        await plugins.uninstall(id, false);
      }
    },
    { id, source, archive, sha256 },
  );
  assert.deepEqual(facts, {
    developerMode: false,
    localDirectoryBlocked: true,
    wrongDigestBlocked: true,
    installed: true,
    insertText: marker,
    disabled: true,
  });
  assert.equal(
    await page.evaluate(
      async (id) =>
        (await window.pigclaude.capabilityPlugins.list()).some(
          (item) => item.manifest.id === id,
        ),
      id,
    ),
    false,
  );
  return {
    packaged: true,
    archiveDigestVerified: true,
    isolatedCommand: true,
    plainText: true,
    disabled: true,
    uninstalled: true,
  };
}
