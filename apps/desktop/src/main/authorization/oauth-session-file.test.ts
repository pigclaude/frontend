// 验证桌面 OAuth 文件能独立写入、重开和退出，不引入旧加密文件的读取或清理。
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { OAuthSessionFile } from "./oauth-session-file"
import { oauthSessionFixture } from "../testing/profile-fixture"

it("在统一文件中保存设备授权，保留独立的旧测试文件", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pigclaude-oauth-file-"))
  const previousFile = join(directory, "authorization-secrets.json")
  const path = join(directory, "oauth-session.json")
  const key = "membership:session"
  try {
    await writeFile(previousFile, "旧格式夹具")
    const sessionFile = new OAuthSessionFile(directory)
    expect(await sessionFile.get(key)).toBeNull()

    const record = oauthSessionFixture()
    await sessionFile.set(key, JSON.stringify(record))
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(record)
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600)

    const reopened = new OAuthSessionFile(directory)
    await expect(reopened.get(key)).resolves.toBe(JSON.stringify(record))
    await reopened.delete(key)
    await expect(reopened.get(key)).resolves.toBeNull()
    expect(await readFile(previousFile, "utf8")).toBe("旧格式夹具")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
