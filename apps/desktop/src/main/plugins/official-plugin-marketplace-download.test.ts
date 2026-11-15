// 用本机生成的归档和假网络核对官方目录下载的来源与字节边界。

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { create } from "tar"
import { afterEach, expect, it, vi } from "vitest"
import { downloadOfficialPluginMarketplace } from "./official-plugin-marketplace-download"

const commit = "a1".repeat(20)
const headUrl = "https://api.github.com/repos/pigclaude/plugs/commits?per_page=1"
const archiveUrl = "https://codeload.github.com/pigclaude/plugs/tar.gz/" + commit
const catalogPath = "marketplace.json"
const signaturePath = catalogPath + ".sig"
const catalog = Buffer.from(' { "name": "fixture-market", "plugins": [] }\r\n')
const signature = Buffer.from(' { "message": "Synthetic signature bytes" }\n')
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

it("只解析官方仓库默认分支的完整提交，从一次固定归档返回目录和签名原始字节", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      head([{ sha: commit.toUpperCase(), url: "https://example.test/unused" }]),
    )
    .mockResolvedValueOnce(await archive({ [catalogPath]: catalog, [signaturePath]: signature }))
  await expect(downloadOfficialPluginMarketplace(fetcher)).resolves.toEqual({
    commit,
    catalog,
    signature,
  })
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([headUrl, archiveUrl])
  for (const [, options] of fetcher.mock.calls) {
    expect(options).toMatchObject({
      redirect: "manual",
      credentials: "omit",
      signal: expect.any(AbortSignal),
    })
    expect(new Headers(options?.headers).has("authorization")).toBe(false)
  }
})

it.each([catalogPath, signaturePath])("归档只含 %s 时拒绝，不另从分支补读另一份", async (name) => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(head([{ sha: commit }]))
    .mockResolvedValueOnce(await archive({ [name]: Buffer.from("fixture") }))
  await expect(downloadOfficialPluginMarketplace(fetcher)).rejects.toThrow(
    "PLUGIN_MARKETPLACE_OFFICIAL_UNAVAILABLE",
  )
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([headUrl, archiveUrl])
})

it.each([
  { payload: [] },
  { payload: [{ sha: "main" }] },
  { payload: [{ sha: commit.slice(0, 8) }] },
  { payload: [{ sha: commit }, { sha: "b".repeat(40) }] },
])("默认分支响应缺少唯一完整提交时不请求归档 (%j)", async ({ payload }) => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(head(payload))
  await expect(downloadOfficialPluginMarketplace(fetcher)).rejects.toThrow(
    "PLUGIN_MARKETPLACE_OFFICIAL_UNAVAILABLE",
  )
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([headUrl])
})

it("拒绝官方来源跳转，也不从跳转目标读取内容", async () => {
  const redirect = () =>
    new Response(null, { status: 302, headers: { location: "https://example.test/unused" } })
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(redirect())
  await expect(downloadOfficialPluginMarketplace(fetcher)).rejects.toThrow(
    "PLUGIN_MARKETPLACE_OFFICIAL_UNAVAILABLE",
  )
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([headUrl])
  fetcher
    .mockReset()
    .mockResolvedValueOnce(head([{ sha: commit }]))
    .mockResolvedValueOnce(redirect())
  await expect(downloadOfficialPluginMarketplace(fetcher)).rejects.toThrow(
    "PLUGIN_MARKETPLACE_OFFICIAL_UNAVAILABLE",
  )
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([headUrl, archiveUrl])
})

it("默认分支响应超过字节上限时取消读取", async () => {
  const bytes = new Uint8Array(64 * 1024)
  let chunks = 0
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (chunks++ < 5) controller.enqueue(bytes)
      else controller.close()
    },
    cancel,
  })
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(stream))
  await expect(downloadOfficialPluginMarketplace(fetcher)).rejects.toThrow(
    "PLUGIN_MARKETPLACE_OFFICIAL_UNAVAILABLE",
  )
  expect(cancel).toHaveBeenCalledOnce()
  expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([headUrl])
})

it("默认分支读取被超时信号取消时结束刷新", async () => {
  const expired = new AbortController()
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(expired.signal)
  const fetcher = vi.fn<typeof fetch>(
    async (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => reject(new Error("合成超时")), {
          once: true,
        })
      }),
  )
  try {
    const download = downloadOfficialPluginMarketplace(fetcher)
    expired.abort()
    await expect(download).rejects.toThrow("PLUGIN_MARKETPLACE_OFFICIAL_UNAVAILABLE")
    expect(timeout).toHaveBeenCalledWith(20_000)
    expect(fetcher.mock.calls.map(([url]) => String(url))).toEqual([headUrl])
  } finally {
    timeout.mockRestore()
  }
})

function head(value: unknown): Response {
  return Response.json(value)
}

async function archive(contents: Record<string, Buffer>): Promise<Response> {
  const root = await mkdtemp(join(tmpdir(), "pigclaude-official-marketplace-"))
  directories.push(root)
  const prefix = "plugs-" + commit
  const metadata = join(root, prefix, ".claude-plugin")
  await mkdir(metadata, { recursive: true })
  for (const [name, bytes] of Object.entries(contents)) await writeFile(join(metadata, name), bytes)
  const target = join(root, "fixture.tgz")
  await create({ cwd: root, gzip: true, portable: true, file: target }, [prefix])
  return new Response(new Uint8Array(await readFile(target)))
}
