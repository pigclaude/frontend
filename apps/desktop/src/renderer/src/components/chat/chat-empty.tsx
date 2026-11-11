// 负责新会话空状态：选择工作区、最近工作区、模型/账号/权限设置和开始会话入口。

import { Icon } from "../icon"
import { Button } from "../ui/button"
import { Composer, type ComposerSettings } from "../composer"
import { projectNameFromPath } from "../../models/project-model"
import type { Screen } from "../../screens/screen"

/** 新会话空状态 props。 */
export type ChatEmptyProps = {
  workspace: string | null
  workspaceOptions: string[]
  composer: ComposerSettings
  modelsLoading: boolean
  modelsError: string | null
  error: string | null
  onPickWorkspace: () => void
  onSelectWorkspace: (path: string) => void
  onStart: () => void
  onSubmit: (text: string) => boolean | Promise<boolean>
  onRetryModels: () => void
  onCancelModels: () => void
  onOpen: (screen: Screen) => void
}

/** 绘制空状态；没有工作区时只提示选择，不伪造聊天内容。 */
export function ChatEmpty({
  workspace,
  workspaceOptions,
  composer,
  modelsLoading,
  modelsError,
  error,
  onPickWorkspace,
  onSelectWorkspace,
  onStart,
  onSubmit,
  onRetryModels,
  onCancelModels,
  onOpen,
}: ChatEmptyProps) {
  return (
    <section className="view">
      <div className="panel-top">
        <span className="spacer" />
        <Button
          variant="plain"
          className="icon-btn"
          type="button"
          aria-label="环境检测"
          onClick={() => onOpen("environment")}
        >
          <Icon name="server" />
        </Button>
      </div>
      <div className="hero">
        <div className="hero-inner">
          <div className="ctx-row">
            <Button variant="plain" className="chip-btn" type="button" onClick={onPickWorkspace}>
              <Icon name="folder" small />
              {workspace === null ? "选择工作区" : projectNameFromPath(workspace)}
              <Icon name="down" small />
            </Button>
            {modelsLoading ? (
              <Button variant="plain" className="chip-btn" type="button" onClick={onCancelModels}>
                模型加载中… 取消
              </Button>
            ) : null}
          </div>
          <h1 className="hero-title">
            {workspace === null ? "先选择一个工作区" : "让 Claude 在这个文件夹里工作"}
          </h1>
          <Composer
            {...composer}
            placeholder="让 Claude 做点什么，@ 引用文件，/ 使用命令"
            tall
            menuSide="bottom"
            onSubmit={onSubmit}
          />
          {error === null ? null : (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          {modelsError === null ? null : (
            <p className="note hero-note">
              模型列表不可用：{modelsError}{" "}
              <Button variant="ghost" size="sm" onClick={onRetryModels}>
                重试
              </Button>
            </p>
          )}
          <div className="row hero-start">
            <Button variant="primary" disabled={workspace === null} onClick={onStart}>
              开始会话
            </Button>
            <span className="note">会话通过本机中继发出，只记录用量元数据。</span>
          </div>
          <div className="section-head hero-recent">
            <h2>最近工作区</h2>
          </div>
          {workspaceOptions.length === 0 ? (
            <p className="note">还没有最近工作区。选择一个文件夹后开始。</p>
          ) : (
            <div className="suggest">
              {workspaceOptions.map((path) => (
                <Button
                  variant="plain"
                  key={path}
                  className="sg"
                  type="button"
                  onClick={() => onSelectWorkspace(path)}
                >
                  <span className="tile">
                    <Icon name="folder" />
                  </span>
                  <b>{projectNameFromPath(path)}</b>
                  <span className="truncate mono">{path}</span>
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
