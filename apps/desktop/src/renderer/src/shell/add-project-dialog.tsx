// 负责「添加项目」对话框：填写或用系统选择框选一个文件夹，确认后加入最近工作区。
// PigClaude 的工作区只记路径，项目名取自文件夹名，所以不像 Pigcode 那样另填名称和设备。
import { useState } from "react"
import { Button, Dialog, Field, Input, useLocale } from "@pigclaude/ui-primitives"
import { fill, useText } from "../locale/text"
import { projectNameFromPath } from "../models/project-model"

/** 对话框需要的状态与事件。 */
export type AddProjectDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (path: string) => void
}

/** 添加项目对话框；关闭时清空输入。 */
export function AddProjectDialog({ open, onOpenChange, onAdd }: AddProjectDialogProps) {
  const { t: pt } = useLocale()
  const { t } = useText()
  const [path, setPath] = useState("")
  const name = projectNameFromPath(path)
  const pickFolder = window.pigclaude?.pickFolder

  function close(next: boolean): void {
    if (!next) setPath("")
    onOpenChange(next)
  }

  async function pick(): Promise<void> {
    const picked = await pickFolder?.({
      title: t("shell.project.pickerTitle"),
      buttonLabel: t("shell.project.pickerButton"),
    })
    if (picked) setPath(picked)
  }

  return (
    <Dialog.Root open={open} onOpenChange={close}>
      <Dialog.Content
        title={t("shell.project.title")}
        description={t("shell.project.description")}
        closeLabel={pt("common.close")}
      >
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!name) return
            onAdd(path)
            close(false)
          }}
        >
          <Dialog.Body>
            <Field.Root>
              <Field.Label>{t("shell.project.folder")}</Field.Label>
              <div className="row">
                <Input
                  className="mono grow"
                  value={path}
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  placeholder="~/workspace/my-project"
                  onChange={(event) => setPath(event.target.value)}
                />
                {pickFolder ? (
                  <Button type="button" onClick={() => void pick()}>
                    {t("shell.project.pick")}
                  </Button>
                ) : null}
              </div>
              <Field.Description>
                {name
                  ? fill(t("shell.project.namePreview"), { name })
                  : t("shell.project.pathHint")}
              </Field.Description>
            </Field.Root>
          </Dialog.Body>
          <Dialog.Footer>
            <Button type="button" variant="ghost" onClick={() => close(false)}>
              {pt("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={!name}>
              {t("shell.project.add")}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
