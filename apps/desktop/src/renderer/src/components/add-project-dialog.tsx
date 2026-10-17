// 负责「添加项目」对话框：选择或填写文件夹路径，确认后交给侧栏加入项目树。
import { useState } from "react"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog"
import { Input } from "./ui/input"
import { projectNameFromPath } from "../models/project-model"

/** 添加项目对话框；关闭时清空输入。 */
export function AddProjectDialog({
  open,
  onOpenChange,
  onAdd,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (path: string) => void
}) {
  const [path, setPath] = useState("")
  const name = projectNameFromPath(path)
  const canPick = Boolean(window.pigclaude?.pickFolder)

  function close(next: boolean): void {
    if (!next) setPath("")
    onOpenChange(next)
  }

  async function pick(): Promise<void> {
    const picked = await window.pigclaude?.pickFolder?.()
    if (picked) setPath(picked)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <div className="dialog-head">
          <DialogTitle>添加项目</DialogTitle>
          <DialogDescription>会话在这个文件夹里运行，项目名取自文件夹名。</DialogDescription>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!name) return
            onAdd(path)
            close(false)
          }}
        >
          <div className="dialog-body">
            <div className="field">
              <label htmlFor="project-path">文件夹</label>
              <div className="row">
                <Input
                  id="project-path"
                  className="mono grow"
                  value={path}
                  autoFocus
                  spellCheck={false}
                  placeholder="~/workspace/my-project"
                  onChange={(event) => setPath(event.target.value)}
                />
                {canPick ? (
                  <Button type="button" onClick={() => void pick()}>
                    选择…
                  </Button>
                ) : null}
              </div>
              <span className="hint">{name ? `项目名：${name}` : "填写或选择一个文件夹"}</span>
            </div>
          </div>
          <div className="dialog-foot">
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={!name}>
              添加
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
