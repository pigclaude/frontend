// 把项目 Git 差异、检查点、工作树和 PR 接到 Pigcode 的工作台组件。
import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { Button, useLocale, type HostErrorInfo } from "@pigclaude/ui-primitives"
import { CheckpointPanel, DiffView, PrPanel, WorktreePicker } from "@pigclaude/ui-workbench"
import type { PullRequestInfo } from "@pigclaude/ui-contracts"
import type {
  WorkbenchBridge,
  WorkbenchCheckpoint,
  WorkbenchWorktree,
} from "../../../workbench-contract"
import { useText } from "../locale/text"
import { workbenchError } from "./workbench-errors"

type ProjectProps = { bridge: WorkbenchBridge; root: string; revision: number }

/** 按 HEAD 或选中检查点展示工作区差异；新回复结束后自动刷新。 */
export function DiffPane({ bridge, root, revision, path }: ProjectProps & { path?: string }) {
  const { t } = useLocale()
  const { t: text } = useText()
  const [patch, setPatch] = useState("")
  const [checkpoints, setCheckpoints] = useState<WorkbenchCheckpoint[]>([])
  const [base, setBase] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    void bridge
      .checkpoints(root)
      .then((items) => {
        if (active) setCheckpoints(items)
      })
      .catch(() => undefined)
    void bridge
      .diff(root, path, base || undefined)
      .then(
        (result) => {
          if (active) {
            setPatch(result)
            setError(null)
          }
        },
        (failure: unknown) => {
          if (active) setError(workbenchError(failure, text))
        },
      )
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [bridge, root, revision, path, base, refresh, text])
  return (
    <div className="workbench-diff">
      <header className="workbench-section-header">
        <span className="grow truncate">{path || t("workbench.diff")}</span>
        {checkpoints.length > 0 ? (
          <select
            aria-label={t("workbench.diffBase")}
            value={base}
            onChange={(event) => {
              setLoading(true)
              setBase(event.target.value)
            }}
          >
            <option value="">{t("workbench.diffBaseDefault")}</option>
            <option value="HEAD">HEAD</option>
            {[...checkpoints].reverse().map((item) => (
              <option value={item.id} key={item.id}>
                {new Date(item.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        ) : null}
        <Button
          type="button"
          variant="plain"
          size="icon"
          aria-label={text("workbench.refresh")}
          onClick={() => {
            setLoading(true)
            setRefresh((value) => value + 1)
          }}
        >
          <RefreshCw className="ic ic-sm" aria-hidden="true" />
        </Button>
      </header>
      {error ? (
        <p className="workbench-error" role="alert">
          {error}
        </p>
      ) : loading ? (
        <p role="status">{t("workbench.diff.loading")}</p>
      ) : (
        <DiffView diff={patch} />
      )}
    </div>
  )
}

/** 创建和恢复 Git 检查点，恢复操作由 Pigcode 面板要求二次确认。 */
export function CheckpointsPane({
  bridge,
  root,
  revision,
  onChanged,
  turnActive,
}: ProjectProps & {
  onChanged: () => void
  turnActive: boolean
}) {
  const { t } = useLocale()
  const { t: text } = useText()
  const [items, setItems] = useState<WorkbenchCheckpoint[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void bridge
      .checkpoints(root)
      .then((result) => {
        if (active) setItems(result)
      })
      .catch((failure: unknown) => {
        if (active) setError(workbenchError(failure, text))
      })
    return () => {
      active = false
    }
  }, [bridge, root, revision, text])

  async function mutate(task: () => Promise<void>): Promise<void> {
    if (busy || turnActive) return
    setBusy(true)
    setError(null)
    try {
      await task()
      onChanged()
    } catch (failure: unknown) {
      setError(workbenchError(failure, text))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="workbench-section-header">
        <span>{t("workbench.checkpoint")}</span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={busy || turnActive}
          onClick={() => void mutate(() => bridge.capture(root))}
        >
          {t("workbench.createCheckpoint")}
        </Button>
      </header>
      {error ? (
        <p className="workbench-error" role="alert">
          {error}
        </p>
      ) : null}
      <CheckpointPanel
        checkpoints={items}
        restoring={busy || turnActive}
        onRestore={(id) => mutate(() => bridge.restore(root, id))}
      />
    </>
  )
}

/** 展示项目的工作树，用选择的目录作为下一次会话及右栏的工作目录。 */
export function Worktrees({
  bridge,
  root,
  revision,
  current,
  onSelect,
  onChanged,
  confirmSwitch,
  sessionActive,
}: ProjectProps & {
  current: string
  onSelect: (path: string) => Promise<void>
  onChanged: () => void
  confirmSwitch: () => boolean
  sessionActive: boolean
}) {
  const { t } = useText()
  const [items, setItems] = useState<WorkbenchWorktree[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    void bridge
      .worktrees(root)
      .then((result) => {
        if (active) setItems(result)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [bridge, root, revision])

  async function run(action: () => Promise<void>): Promise<void> {
    setError(null)
    try {
      await action()
      onChanged()
    } catch (failure: unknown) {
      setError(workbenchError(failure, t))
    }
  }

  if (items.length === 0) return null
  const main = items[0]?.path ?? root
  return (
    <div className="workbench-worktree-compact">
      {error ? (
        <p className="workbench-error" role="alert">
          {error}
        </p>
      ) : null}
      <WorktreePicker
        worktrees={items
          .filter((item) => item.path !== main)
          .map((item) => ({ ...item, id: item.path }))}
        activePath={current === main ? null : current}
        busy={sessionActive}
        onCreate={() =>
          run(async () => {
            if (confirmSwitch()) await onSelect((await bridge.createWorktree(root)).path)
          })
        }
        onSwitch={(path) =>
          run(async () => {
            if (path !== current && confirmSwitch()) await onSelect(path)
          })
        }
        onRemove={() =>
          run(async () => {
            if (!confirmSwitch()) return
            await bridge.removeWorktree(root, current)
            await onSelect(main)
          })
        }
        compact
      />
      {current !== main ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={sessionActive}
          onClick={() =>
            void run(async () => {
              if (confirmSwitch()) await onSelect(main)
            })
          }
        >
          {t("workbench.rootDirectory")}
        </Button>
      ) : null}
    </div>
  )
}

/** 查询当前 PR，用户提交表单时使用已经推送的当前分支创建 PR。 */
export function PullRequestPane({ bridge, root, revision }: ProjectProps) {
  const [pr, setPr] = useState<PullRequestInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<HostErrorInfo | null>(null)

  useEffect(() => {
    let active = true
    void bridge
      .pullRequest(root)
      .then(
        (result) => {
          if (active) {
            setPr(result)
            setError(null)
          }
        },
        (failure: unknown) => {
          if (active) setError(prError(failure))
        },
      )
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [bridge, root, revision])

  return (
    <PrPanel
      pullRequest={pr}
      error={error}
      loading={loading}
      creating={creating}
      onCreate={async (input) => {
        setCreating(true)
        try {
          await bridge.createPullRequest(root, input)
          setPr(await bridge.pullRequest(root))
          setError(null)
        } catch (failure: unknown) {
          setError(prError(failure))
          throw failure
        } finally {
          setCreating(false)
        }
      }}
    />
  )
}

function prError(error: unknown): HostErrorInfo {
  const message = error instanceof Error ? error.message : ""
  const code = (["GH_NOT_AVAILABLE", "GH_NOT_AUTHENTICATED", "GIT_NO_REMOTE"] as const).find(
    (known) => message.includes(known),
  )
  return { code: code ?? "INTERNAL_ERROR", message: code ?? "WORKBENCH_PR_FAILED" }
}
