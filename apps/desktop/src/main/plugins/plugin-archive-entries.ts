// 为两种归档共享计数、可跨平台的相对路径和包根限制。

/** 限制压缩输入为 32 MiB、解压数据为 64 MiB、每个文件为 16 MiB、条目为 2048 个。 */
export const pluginArchiveLimits = {
  inputBytes: 32 * 1024 * 1024,
  expandedBytes: 64 * 1024 * 1024,
  fileBytes: 16 * 1024 * 1024,
  entries: 2048,
} as const

/** 归档读取向主进程调用方提供的稳定错误码。 */
export type PluginArchiveErrorCode =
  | "PLUGIN_ARCHIVE_INVALID"
  | "PLUGIN_ARCHIVE_UNSAFE"
  | "PLUGIN_ARCHIVE_TOO_LARGE"
  | "PLUGIN_ARCHIVE_SHA256_INVALID"
  | "PLUGIN_ARCHIVE_SHA256_MISMATCH"

/** 归档错误不含本机路径或归档内的原始名字。 */
export class PluginArchiveError extends Error {
  /** 将固定错误码作为错误消息。 */
  constructor(readonly code: PluginArchiveErrorCode) {
    super(code)
    this.name = "PluginArchiveError"
  }
}

/** 将解析器和解压器的私有错误转换为稳定错误码。 */
export function pluginArchiveError(error: unknown): PluginArchiveError {
  if (error instanceof PluginArchiveError) return error
  if (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE")
    return new PluginArchiveError("PLUGIN_ARCHIVE_TOO_LARGE")
  return new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
}

type ReservedPath = { path: string; directory: boolean; explicit: boolean }
const reservedDevice = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|(?:com|lpt)[0-9¹²³])$/i

/** 在读取文件正文前检查声明的大小和路径，并拒绝 Windows 与 POSIX 上的路径冲突。 */
export class PluginArchiveEntries {
  readonly #paths = new Map<string, ReservedPath>()
  readonly #files = new Map<string, Buffer>()
  #count = 0
  #totalBytes = 0

  /** 计入一个归档记录，包括不会成为输出文件的目录或格式元数据。 */
  countRecord(): void {
    this.#count += 1
    if (this.#count > pluginArchiveLimits.entries)
      throw new PluginArchiveError("PLUGIN_ARCHIVE_TOO_LARGE")
  }

  /** 预留一个已校验路径与文件大小。目录返回 null。 */
  reserve(name: string, directory: boolean, size: number): string | null {
    this.countRecord()
    if (!Number.isSafeInteger(size) || size < 0 || (directory && size !== 0))
      throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
    this.#totalBytes += size
    if (
      size > pluginArchiveLimits.fileBytes ||
      this.#totalBytes > pluginArchiveLimits.expandedBytes
    )
      throw new PluginArchiveError("PLUGIN_ARCHIVE_TOO_LARGE")
    const parts = archivePathParts(name, directory)
    for (let index = 1; index < parts.length; index += 1)
      this.#recordPath(parts.slice(0, index).join("/"), true, false)
    const path = parts.join("/")
    this.#recordPath(path, directory, true)
    return directory ? null : path
  }

  /** 正文大小必须与归档记录相符，才成为最终文件表的一部分。 */
  save(path: string, size: number, contents: Buffer): void {
    if (contents.length !== size) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
    this.#files.set(path, contents)
  }

  /** 返回包根的普通文件。所有文件共用一个发布目录时剥掉该目录。 */
  finish(): ReadonlyMap<string, Buffer> {
    const first = this.#files.keys().next().value
    if (first === undefined) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
    const slash = first.indexOf("/")
    if (slash < 0) return this.#files
    const prefix = first.slice(0, slash + 1)
    if (![...this.#files.keys()].every((path) => path.startsWith(prefix))) return this.#files
    return new Map(
      [...this.#files].map(([path, contents]) => [path.slice(prefix.length), contents]),
    )
  }

  #recordPath(path: string, directory: boolean, explicit: boolean): void {
    const key = path.toLowerCase().normalize("NFC")
    const prior = this.#paths.get(key)
    if (
      prior &&
      (prior.path !== path || !prior.directory || !directory || (prior.explicit && explicit))
    )
      throw new PluginArchiveError("PLUGIN_ARCHIVE_UNSAFE")
    if (!prior || explicit) this.#paths.set(key, { path, directory, explicit })
  }
}

function archivePathParts(name: string, directory: boolean): string[] {
  const normalized = name.replaceAll("\\", "/").normalize("NFC")
  if (normalized.startsWith("/") || Buffer.byteLength(normalized) > 1024)
    throw new PluginArchiveError("PLUGIN_ARCHIVE_UNSAFE")
  const parts = normalized.split("/").filter((part) => part !== "" && part !== ".")
  if (parts.length > 32 || (!directory && (parts.length === 0 || normalized.endsWith("/"))))
    throw new PluginArchiveError("PLUGIN_ARCHIVE_UNSAFE")
  for (const part of parts) {
    if (
      part === ".." ||
      /[<>:"|?*\p{Cc}\p{Cf}]/u.test(part) ||
      /[. ]$/.test(part) ||
      Buffer.byteLength(part) > 255 ||
      reservedDevice.test((part.split(".", 1)[0] ?? "").trimEnd())
    )
      throw new PluginArchiveError("PLUGIN_ARCHIVE_UNSAFE")
  }
  return parts
}
