// 只汇总 Windows 检查点诊断所需的 Git Trace2 状态，既不复制也不输出原始追踪。
import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"

const [traceDir, acceptanceLog] = process.argv.slice(2)
const traceFiles = await readdir(traceDir)
const output = await readFile(acceptanceLog, "utf8")
const failures = output.matchAll(
  /Workbench IPC failed (checkpoint-[a-z-]+) git ([a-z-]+) code=(-?\w+) signal=(\w+) pid=(\d+) elapsedMs=(\d+) stdoutBytes=(\d+) stderrBytes=(\d+) stderrKind=(\w+)/g,
)

function summarize(events) {
  const codeOf = (name) => {
    const code = events.findLast((event) => event.event === name)?.code
    return Number.isInteger(code) ? code : null
  }
  return {
    start: events.some((event) => event.event === "start"),
    startedCommand: events.some((event) => event.event === "cmd_name"),
    sawError: events.some((event) => event.event === "error"),
    exit: codeOf("exit"),
    atexit: codeOf("atexit"),
    lastEvent: events.at(-1)?.event ?? null,
  }
}

console.log("PC164 traces", traceFiles.length)
if (traceFiles.length === 0) process.exitCode = 2
for (const [, phase, command, code, signal, pid, elapsed, stdout, stderr, stderrKind] of failures) {
  const suffix = `-P${Number(pid).toString(16).padStart(8, "0")}`.toLowerCase()
  const file = traceFiles.find((name) => name.toLowerCase().endsWith(suffix))
  const events = (file ? await readFile(join(traceDir, file), "utf8") : "")
    .split("\n")
    .flatMap((line) => {
      try {
        const event = JSON.parse(line)
        return typeof event.event === "string" && /^[a-z_]+$/.test(event.event) ? [event] : []
      } catch {
        return []
      }
    })
  console.log(
    "PC164 checkpoint failure",
    JSON.stringify({
      phase,
      command,
      code,
      signal,
      pid,
      elapsed,
      stdout,
      stderr,
      stderrKind,
      ...summarize(events),
    }),
  )
}
