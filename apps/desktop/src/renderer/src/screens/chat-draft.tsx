// 把桌面会话草稿接到 Pigcode 的新会话页，保留项目控件与启动错误。

import type { ComponentProps, ReactNode } from "react"
import type {
  ComposerCommand,
  ComposerSubmitOptions,
  ComposerThreadOption,
} from "@pigclaude/ui-composer"
import { NewThreadView } from "@pigclaude/ui-chat"
import { ToolRenderers } from "../components/tool-renderers"
import { Button } from "../components/ui/button"
import { useText } from "../locale/text"
import type { ComposerConfig } from "../models/composer-config"
import { projectNameFromPath } from "../models/project-model"
import type { ProjectDraftEditor } from "../hooks/use-project-draft"
import type { DraftWorkspace } from "./draft-workspace"

type Props = {
  composer: ComposerConfig
  workspace: DraftWorkspace
  projectDraft: ProjectDraftEditor | undefined
  projects: readonly string[]
  projectId: string | null
  configuration?: { path: string; open: (path: string) => void }
  commands: readonly ComposerCommand[]
  loadAgentCommands?: ComponentProps<typeof NewThreadView>["loadAgentCommands"]
  threads: readonly ComposerThreadOption[]
  openIn: ReactNode
  layoutControls: ReactNode
  onSelectProject: (path: string) => void
  onAddProject: () => void
  onSubmit: (text: string, options: ComposerSubmitOptions) => void
}

/** 显示尚未创建会话的草稿，启动失败时在草稿输入框下展示原因。 */
export function ChatDraft({
  composer,
  workspace,
  projectDraft,
  projects,
  configuration,
  ...props
}: Props) {
  const { t } = useText()
  const error = projectDraft?.draft.error
  return (
    <ToolRenderers>
      <NewThreadView
        {...props}
        projects={projects.map((path) => ({
          id: path,
          name: projectNameFromPath(path),
          rootPath: path,
        }))}
        workspaceControls={
          configuration ? (
            <>
              {workspace.controls}
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => configuration.open(configuration.path)}
              >
                {t("shell.projectConfig.entry")}
              </Button>
            </>
          ) : (
            workspace.controls
          )
        }
        workspaceStatus={
          <>
            {workspace.status}
            {error ? (
              <p className="draft-workspace-status error-text" role="alert">
                {error}
              </p>
            ) : null}
          </>
        }
        pending={workspace.busy || projectDraft?.draft.pending === true}
        draftKey={composer.draftKey}
        agents={composer.agents}
        catalog={composer.catalog}
        onLoadModels={composer.onLoadModels}
        agentId={composer.agentId}
        modelId={composer.modelId}
        onSelectModel={composer.onSelectModel}
        permissionMode={composer.permissionMode}
        onPermissionMode={composer.onPermissionMode}
        planMode={composer.planMode}
        onPlanMode={composer.onPlanMode}
        files={composer.files}
      />
    </ToolRenderers>
  )
}
