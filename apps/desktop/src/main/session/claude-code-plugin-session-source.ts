// 定义会话从已安装 Claude Code 插件读取本次副本和草稿命令的接口。

/** 主进程提供的已启用 Claude Code 插件来源。 */
export type ClaudeCodePluginSessionSource = {
  /** 把已启用插件复制到已有的空目录，返回这个目录内的本地插件根。 */
  stage(directory: string): Promise<readonly string[]>
  /** 返回草稿可展示的不带斜杠的 namespaced 命令和 skill 名。 */
  commands(): Promise<readonly string[]>
}
