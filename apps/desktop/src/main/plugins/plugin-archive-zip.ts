// 校验普通 ZIP 的中心目录、本地记录和正文。只支持 ZIP32 的存储与 Deflate。

import { promisify } from "node:util"
import { crc32, inflateRaw } from "node:zlib"
import {
  PluginArchiveError,
  pluginArchiveLimits,
  type PluginArchiveEntries,
} from "./plugin-archive-entries"

const decode = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
const inflate = promisify(inflateRaw)
const localSignature = 0x04034b50
const centralSignature = 0x02014b50
const descriptorSignature = 0x08074b50
const endSignature = 0x06054b50
const localHeaderBytes = 30
const centralHeaderBytes = 46
const endRecordBytes = 22
const dataDescriptorFlag = 0x08
const supportedFlags = 0x080e

type CentralEntry = {
  filename: Buffer
  directory: boolean
  flags: number
  method: number
  checksum: number
  compressedSize: number
  size: number
  offset: number
}
type LocalEntry = CentralEntry & { contents: Buffer; end: number; path: string | null }

/** 读取经过哈希验证的 ZIP。在解压前核对每个本地记录、计数与路径。 */
export async function readPluginZip(bytes: Buffer, output: PluginArchiveEntries): Promise<void> {
  const directory = centralDirectory(bytes)
  const entries: LocalEntry[] = []
  let cursor = directory.offset
  for (let index = 0; index < directory.count; index += 1) {
    const { entry, next } = readCentralEntry(bytes, cursor, directory.end)
    const { contents, end } = readLocalEntry(bytes, entry, directory.offset)
    const path = output.reserve(decode.decode(entry.filename), entry.directory, entry.size)
    entries.push({ ...entry, path, contents, end })
    cursor = next
  }
  if (cursor !== directory.end) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  verifyLocalLayout(entries, directory.offset)
  for (const entry of entries) {
    const data = entry.method === 0 ? Buffer.from(entry.contents) : await readDeflate(entry)
    if (data.length !== entry.size || crc32(data) !== entry.checksum)
      throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
    if (entry.path !== null) output.save(entry.path, entry.size, data)
  }
}

function centralDirectory(bytes: Buffer): { offset: number; end: number; count: number } {
  // 记录位于结尾，最多在 65535 字节的注释之前。
  const lower = Math.max(0, bytes.length - endRecordBytes - 0xffff)
  let end: number | undefined
  for (let index = bytes.length - endRecordBytes; index >= lower; index -= 1) {
    if (
      bytes.readUInt32LE(index) !== endSignature ||
      index + endRecordBytes + bytes.readUInt16LE(index + 20) !== bytes.length
    )
      continue
    if (end !== undefined) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
    end = index
  }
  if (end === undefined) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  const count = bytes.readUInt16LE(end + 10)
  const size = bytes.readUInt32LE(end + 12)
  const offset = bytes.readUInt32LE(end + 16)
  if (count > pluginArchiveLimits.entries) throw new PluginArchiveError("PLUGIN_ARCHIVE_TOO_LARGE")
  if (
    bytes.readUInt32LE(end + 4) !== 0 ||
    bytes.readUInt16LE(end + 8) !== count ||
    offset + size !== end ||
    count * centralHeaderBytes > size
  )
    throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  return { offset, end, count }
}

function readCentralEntry(bytes: Buffer, start: number, limit: number) {
  const name = start + centralHeaderBytes
  if (name > limit || bytes.readUInt32LE(start) !== centralSignature)
    throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  const extra = name + bytes.readUInt16LE(start + 28)
  const comment = extra + bytes.readUInt16LE(start + 30)
  const next = comment + bytes.readUInt16LE(start + 32)
  const flags = bytes.readUInt16LE(start + 8)
  const method = bytes.readUInt16LE(start + 10)
  if (
    next > limit ||
    extra === name ||
    bytes.readUInt16LE(start + 34) !== 0 ||
    (flags & ~supportedFlags) !== 0 ||
    (method !== 0 && method !== 8) ||
    (method === 0 && (flags & 0x06) !== 0)
  )
    throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  checkExtras(bytes, extra, comment)
  const filename = bytes.subarray(name, extra)
  const entry: CentralEntry = {
    filename,
    directory: isDirectory(bytes.readUInt32LE(start + 38), filename),
    flags,
    method,
    checksum: bytes.readUInt32LE(start + 16),
    compressedSize: bytes.readUInt32LE(start + 20),
    size: bytes.readUInt32LE(start + 24),
    offset: bytes.readUInt32LE(start + 42),
  }
  if (entry.method === 0 && entry.size !== entry.compressedSize)
    throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  return { entry, next }
}

function isDirectory(attributes: number, filename: Buffer): boolean {
  const unixType = (attributes >>> 16) & 0o170000
  const dosDirectory = (attributes & 0x10) !== 0
  const reparsePoint = (attributes & 0x400) !== 0
  if (reparsePoint || (unixType !== 0 && unixType !== 0o100000 && unixType !== 0o040000))
    throw new PluginArchiveError("PLUGIN_ARCHIVE_UNSAFE")
  const last = filename.at(-1)
  const directory = dosDirectory || unixType === 0o040000 || last === 0x2f || last === 0x5c
  if (directory && unixType === 0o100000) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  return directory
}

function readLocalEntry(bytes: Buffer, entry: CentralEntry, limit: number) {
  const start = entry.offset
  const name = start + localHeaderBytes
  if (
    name > limit ||
    bytes.readUInt32LE(start) !== localSignature ||
    bytes.readUInt16LE(start + 6) !== entry.flags ||
    bytes.readUInt16LE(start + 8) !== entry.method
  )
    throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  const extra = name + bytes.readUInt16LE(start + 26)
  const contents = extra + bytes.readUInt16LE(start + 28)
  const end = contents + entry.compressedSize
  if (end > limit || !bytes.subarray(name, extra).equals(entry.filename))
    throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  checkExtras(bytes, extra, contents)
  const descriptor = (entry.flags & dataDescriptorFlag) !== 0
  const fields = [entry.checksum, entry.compressedSize, entry.size]
  const actual = fields.map((_value, index) => bytes.readUInt32LE(start + 14 + index * 4))
  if (!fields.every((want, index) => actual[index] === want || (descriptor && actual[index] === 0)))
    throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  return {
    contents: bytes.subarray(contents, end),
    end: descriptor ? readDescriptor(bytes, end, limit, fields) : end,
  }
}

function readDescriptor(
  bytes: Buffer,
  start: number,
  limit: number,
  fields: readonly number[],
): number {
  const matches = (offset: number) =>
    offset + 12 <= limit &&
    fields.every((value, index) => bytes.readUInt32LE(offset + index * 4) === value)
  if (
    start + 16 <= limit &&
    bytes.readUInt32LE(start) === descriptorSignature &&
    matches(start + 4)
  )
    return start + 16
  if (matches(start)) return start + 12
  throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
}

function checkExtras(bytes: Buffer, start: number, end: number): void {
  for (let offset = start; offset < end;) {
    if (offset + 4 > end) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
    const type = bytes.readUInt16LE(offset)
    offset += 4 + bytes.readUInt16LE(offset + 2)
    if (offset > end || type === 0x0001) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
    // 两种旧 Unix 字段可以另行描述链接。拒绝这类记录，避免条目类型有歧义。
    if (type === 0x000d || type === 0x756e) throw new PluginArchiveError("PLUGIN_ARCHIVE_UNSAFE")
  }
}

function verifyLocalLayout(entries: readonly LocalEntry[], limit: number): void {
  let cursor = 0
  for (const entry of [...entries].sort((left, right) => left.offset - right.offset)) {
    if (entry.offset !== cursor) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
    cursor = entry.end
  }
  if (cursor !== limit) throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
}

async function readDeflate(entry: LocalEntry): Promise<Buffer> {
  // info 包含实际读取的压缩字节数，不接受压缩流后多出的正文。
  const output: unknown = await inflate(entry.contents, {
    maxOutputLength: Math.max(1, entry.size),
    info: true,
  })
  if (
    typeof output !== "object" ||
    output === null ||
    !("buffer" in output) ||
    !Buffer.isBuffer(output.buffer) ||
    !("engine" in output) ||
    typeof output.engine !== "object" ||
    output.engine === null ||
    !("bytesWritten" in output.engine) ||
    output.engine.bytesWritten !== entry.compressedSize
  )
    throw new PluginArchiveError("PLUGIN_ARCHIVE_INVALID")
  return output.buffer
}
