// 只汇总逐命令 Trace2 里的成功检查点操作，避免上传原始 Git 追踪。
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

const [directory] = process.argv.slice(2)
let traceFiles = 0
let successfulWriteTrees = 0
for (const name of await readdir(directory)) {
  if (!name.endsWith(".jsonl")) continue
  const lines = (await readFile(join(directory, name), "utf8")).split("\n")
  let wroteTree = false
  let exitedNormally = false
  traceFiles += 1
  for (const line of lines) {
    if (!line) continue
    try {
      const { event, name: command, code } = JSON.parse(line)
      if (event === "cmd_name" && command === "write-tree") wroteTree = true
      if (event === "exit" && code === 0) exitedNormally = true
    } catch {
      continue
    }
  }
  if (wroteTree && exitedNormally) successfulWriteTrees += 1
}
console.log("PC164 trace summary", JSON.stringify({ traceFiles, successfulWriteTrees }))
if (successfulWriteTrees === 0) process.exitCode = 2
