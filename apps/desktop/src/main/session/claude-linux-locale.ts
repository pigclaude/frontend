// 为随 Linux 安装包交付的官方 CLI 初始化 libc 语言，供所有 SDK 查询共用。

import { existsSync } from "node:fs"
import { dirname, isAbsolute, join } from "node:path"
import { ClaudeRuntimeUnavailableError } from "./claude-binary"

const linuxPackage = "@anthropic-ai/claude-agent-sdk-linux-x64/claude"
const library = "pigclaude-cli-locale.so"

/** 给安装态 Linux CLI 单独设置本地初始化库，返回独立的进程环境。 */
export function claudeLaunchEnvironment(
  binaryPath: string,
  env: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const launchEnv = { ...env }
  const resources: unknown = Reflect.get(process, "resourcesPath")
  if (
    process.platform !== "linux" ||
    !launchEnv.LC_ALL ||
    !isAbsolute(binaryPath) ||
    typeof resources !== "string" ||
    binaryPath !== join(resources, "app.asar.unpacked", "node_modules", linuxPackage)
  ) {
    return launchEnv
  }
  if (!existsSync(join(dirname(binaryPath), library))) {
    throw new ClaudeRuntimeUnavailableError(
      "随包 Claude Code 缺少语言初始化库，请重新安装 PigClaude",
    )
  }
  // 由动态链接器定位可执行文件旁的库，安装目录含空格时也无需拆分路径。
  launchEnv.LD_PRELOAD = "$ORIGIN/" + library
  return launchEnv
}
