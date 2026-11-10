// 把账号语言转换为原生进程所需的 POSIX locale，保留地区和脚本，不静默换语言。

/** 返回规范化的 UTF-8 POSIX locale；非法语言明确失败，不能回退成其他地区。 */
export function processLocale(value: string): string {
  const tag = value
    .trim()
    .replace(/\.UTF-?8$/i, "")
    .replaceAll("_", "-")
  const locale = new Intl.Locale(tag)
  return `${locale.baseName.replaceAll("-", "_")}.UTF-8`
}
