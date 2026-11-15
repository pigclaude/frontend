// 给桌面端项目行提供带项目配置入口的右键菜单，保留重命名、显示文件夹和从侧栏移除。
import { useState, type KeyboardEvent, type MouseEvent } from "react"
import type { Project } from "@pigclaude/ui-contracts"
import { Button, Dialog, Input, Menu, useLocale } from "@pigclaude/ui-primitives"
import { Icon, useToast } from "@pigclaude/ui-shell"
import { useText } from "../locale/text"

type Options = {
  projects: readonly Project[]
  onProjectConfiguration?: ((path: string) => void) | undefined
  onRenameProject: (id: string, name: string) => void
  onRemoveProject: (id: string) => void
}

/** 只接管项目行的右键。会话行和没有桌面桥的预览继续使用原生 Pigcode 菜单。 */
export function useProjectRowMenu(options: Options) {
  const { t } = useLocale()
  const { t: text } = useText()
  const toast = useToast()
  const [openAt, setOpenAt] = useState<{
    project: Project
    anchor: { getBoundingClientRect(): DOMRect }
  } | null>(null)
  const [renaming, setRenaming] = useState<Project | null>(null)
  const platform = window.pigclaude?.platform
  const revealLabel =
    platform === "darwin"
      ? "openIn.finder"
      : platform === "win32"
        ? "openIn.explorer"
        : "openIn.fileManager"

  function open(
    event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>,
    x: number,
    y: number,
  ): void {
    if (!options.onProjectConfiguration) return
    if (!(event.target instanceof Element)) return
    const block = event.target.closest(".proj-row")?.closest(".proj-block")
    if (!block) return
    // Pigcode 顺序渲染项目分组，并不在行上暴露项目 id。仅在这里适配固定版本的项目列表结构。
    const index = [...event.currentTarget.querySelectorAll(".proj-block")].indexOf(block)
    const project = options.projects[index]
    if (!project) return
    event.preventDefault()
    event.stopPropagation()
    setOpenAt({ project, anchor: { getBoundingClientRect: () => new DOMRect(x, y, 1, 1) } })
  }

  const choose = (action: () => void): void => {
    setOpenAt(null)
    action()
  }
  const project = openAt?.project
  return {
    onContextMenuCapture: (event: MouseEvent<HTMLElement>) =>
      open(event, event.clientX, event.clientY),
    onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
      if (!(event.target instanceof Element)) return
      const bounds = event.target.getBoundingClientRect()
      open(event, bounds.left, bounds.bottom)
    },
    menu: (
      <>
        {openAt && project ? (
          <Menu.Root
            open
            onOpenChange={(value) => {
              if (!value) setOpenAt(null)
            }}
          >
            <Menu.Portal>
              <Menu.Positioner anchor={openAt.anchor}>
                <Menu.Popup finalFocus={false}>
                  <Menu.Item
                    onClick={() => choose(() => options.onProjectConfiguration?.(project.rootPath))}
                  >
                    <Icon name="gear" small />
                    {text("shell.projectConfig.title")}
                  </Menu.Item>
                  <Menu.Item onClick={() => choose(() => setRenaming(project))}>
                    <Icon name="pencil" small />
                    {t("sidebar.rename")}
                  </Menu.Item>
                  <Menu.Item
                    onClick={() =>
                      choose(() => {
                        void window.pigclaude?.workspaces
                          ?.reveal(project.rootPath)
                          .catch(() => toast(text("shell.projectConfig.openFailed"), "alert"))
                      })
                    }
                  >
                    <Icon name="folder-open" small />
                    {t(revealLabel)}
                  </Menu.Item>
                  <Menu.Separator />
                  <Menu.Item
                    onClick={() =>
                      choose(() => {
                        options.onRemoveProject(project.id)
                        toast(t("sidebar.projectRemoved").replace("{name}", project.name))
                      })
                    }
                  >
                    <Icon name="x" small />
                    {t("sidebar.removeProject")}
                  </Menu.Item>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ) : null}
        {renaming ? (
          <RenameProject
            project={renaming}
            onClose={() => setRenaming(null)}
            onRename={(name) => options.onRenameProject(renaming.id, name)}
          />
        ) : null}
      </>
    ),
  }
}

function RenameProject({
  project,
  onClose,
  onRename,
}: {
  project: Project
  onClose: () => void
  onRename: (name: string) => void
}) {
  const { t } = useLocale()
  const [name, setName] = useState(project.name)
  return (
    <Dialog.Root
      open
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <Dialog.Content title={t("sidebar.rename")} closeLabel={t("common.close")}>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (!name.trim() || name.trim() === project.name) return
            onRename(name.trim())
            onClose()
          }}
        >
          <Dialog.Body>
            <Input
              aria-label={t("sidebar.projectName")}
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </Dialog.Body>
          <Dialog.Footer>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={!name.trim() || name.trim() === project.name}
            >
              {t("sidebar.rename")}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
