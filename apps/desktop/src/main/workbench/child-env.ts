// 为工作台启动的本地工具构造宿主环境，防止桌面进程的供应商和服务配置随子进程继承。

const systemEnvironment = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LANGUAGE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "TERM",
  "COLORTERM",
  "TERM_PROGRAM",
  "EDITOR",
  "VISUAL",
  "SSH_AUTH_SOCK",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "PATHEXT",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "PROGRAMDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "XDG_CONFIG_HOME",
  "XDG_CACHE_HOME",
  "XDG_DATA_HOME",
])

/** 只提供系统路径、语言和交互所需变量；供应商 token 留在会话宿主。 */
export function workbenchChildEnv(source = process.env): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [name, value] of Object.entries(source)) {
    const key = name.toUpperCase()
    if (value !== undefined && (systemEnvironment.has(key) || key.startsWith("LC_"))) {
      environment[name] = value
    }
  }
  return environment
}
