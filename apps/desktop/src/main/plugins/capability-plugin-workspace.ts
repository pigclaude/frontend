// 仅以已授权的会话工作区为根读取有界的 UTF-8 文本。

import { realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { isAbsolute, join } from "node:path"
import { canonicalProjectPath, containsProjectPath } from "../session/project-configuration-scope"
import { workspacePath } from "../workbench/workspace-path"
import { readBoundedPluginFile } from "./plugin-bounded-file"
import { PluginSandboxError, pluginSandboxPayloadLimit } from "./plugin-sandbox-contract"

/** 读取普通文本，保护应用数据和个人 Claude 配置，沿用工作台的路径校验。 */
export async function readCapabilityPluginWorkspaceText(
  workspace: string,
  userDataPath: string,
  relativePath: string,
  assertCurrent: () => void,
): Promise<string> {
  if (!isAbsolute(workspace) || relativePath === "") throw denied()
  const path = await workspacePath(workspace, relativePath)
  const personal = join(homedir(), ".claude")
  const [privateRoot, personalRoot] = await Promise.all([
    realpath(userDataPath),
    canonicalProjectPath(personal),
  ])
  if (containsProjectPath(privateRoot, path) || containsProjectPath(personalRoot ?? personal, path))
    throw denied()
  assertCurrent()
  const bytes = await readBoundedPluginFile(path, pluginSandboxPayloadLimit, true)
  if (bytes.includes(0)) throw denied()
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  if (Buffer.byteLength(JSON.stringify(text)) > pluginSandboxPayloadLimit) throw denied()
  return text
}

function denied() {
  return new PluginSandboxError("PLUGIN_CAPABILITY_DENIED")
}
