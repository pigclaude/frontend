// 负责浏览器预览里的演示工作台：一个只在内存里的小项目，文件面板可以浏览、打开文件并看到 Git 装饰。
// 只在开发预览里使用，不接触真实文件系统、终端或网络；写入和系统操作一律拒绝。
import type { WorkbenchBridge, WorkbenchFile } from "../../../workbench-contract"

/** 演示工作台的项目目录和桥。 */
export type PreviewWorkbench = { root: string; bridge: WorkbenchBridge }

const files: Record<string, string> = {
  "README.md": [
    "# Demo app",
    "",
    "A small project for previewing the **Files** panel.",
    "",
    "## Scripts",
    "",
    "- `pnpm dev` starts the dev server",
    "- `pnpm test` runs the unit tests",
    "",
    "```ts",
    'import { start } from "./src/app"',
    "",
    "start({ port: 5173 })",
    "```",
    "",
  ].join("\n"),
  "package.json": '{\n  "name": "demo-app",\n  "private": true,\n  "type": "module"\n}\n',
  "src/app.ts": [
    'import { createServer } from "node:http"',
    'import { greet } from "./greet"',
    "",
    "/** Starts the demo server on the given port. */",
    "export function start({ port }: { port: number }): void {",
    "  createServer((_request, response) => {",
    '    response.end(greet("PigClaude"))',
    "  }).listen(port)",
    "}",
    "",
  ].join("\n"),
  "src/greet.ts": "export function greet(name: string): string {\n  return `Hello, ${name}!`\n}\n",
  "docs/guide.md": "# Guide\n\nOpen a file from the navigation to preview it.\n",
}

function unavailable(): Promise<never> {
  return Promise.reject(new Error("WORKBENCH_OPERATION_FAILED"))
}

function read(path: string): WorkbenchFile {
  const text = files[path]
  if (text === undefined) throw new Error("WORKBENCH_PATH_INVALID")
  return {
    path,
    text,
    truncated: false,
    binary: false,
    size: new TextEncoder().encode(text).length,
    mtimeMs: 1_760_000_000_000,
    eol: "lf",
  }
}

function children(directory: string) {
  const prefix = directory ? directory + "/" : ""
  const entries = new Map<string, "file" | "directory">()
  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) continue
    const [name, ...rest] = path.slice(prefix.length).split("/")
    if (name) entries.set(name, rest.length > 0 ? "directory" : "file")
  }
  return [...entries]
    .map(([name, kind]) => ({ name, path: prefix + name, kind }))
    .sort((left, right) =>
      left.kind === right.kind
        ? left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
        : left.kind === "directory"
          ? -1
          : 1,
    )
}

/** 生成演示工作台；保证只读，只在浏览器预览里使用。 */
export function createPreviewWorkbench(): PreviewWorkbench {
  return {
    root: "/Users/preview/demo-app",
    bridge: {
      list: async (_root, path) => ({ entries: children(path), truncated: false }),
      search: async (_root, query) => ({
        entries: Object.keys(files)
          .filter((path) => path.toLowerCase().includes(query.trim().toLowerCase()))
          .map((path) => ({ path, kind: "file" as const })),
        truncated: false,
      }),
      read: async (_root, path) => read(path),
      save: unavailable,
      status: async () => [
        { path: "src/app.ts", status: " M" },
        { path: "docs/guide.md", status: "??" },
      ],
      reveal: unavailable,
      editors: async () => [],
      openFile: unavailable,
      saveAs: unavailable,
      diff: async () => "",
      worktrees: async () => [],
      createWorktree: unavailable,
      removeWorktree: unavailable,
      checkpoints: async () => [],
      capture: unavailable,
      restore: unavailable,
      pullRequest: async () => null,
      createPullRequest: unavailable,
      terminalOpen: unavailable,
      terminalWrite: unavailable,
      terminalResize: unavailable,
      terminalClose: async () => undefined,
      browserNavigate: unavailable,
      browserCommand: unavailable,
      browserPresent: async () => undefined,
      browserPick: unavailable,
      browserClose: async () => undefined,
      browserExternal: unavailable,
      previewOpen: unavailable,
      subscribe: () => () => undefined,
    },
  }
}
