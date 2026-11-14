// 负责展示已归档会话。打开时只切到保存的会话，续接由聊天页的下一次发送触发。

import {
  Button,
  EmptyState,
  SettingPage,
  SettingRow,
  SettingSection,
} from "@pigclaude/ui-primitives"
import { ScrollPanel } from "@pigclaude/ui-shell"
import type { SessionHistoryController } from "../../hooks/use-session-history"
import { useText } from "../../locale/text"
import { projectNameFromPath } from "../../models/project-model"
import type { SavedSessionSummary } from "../../models/saved-session"

/** 显示归档清单，并提供打开、取消归档和删除入口。 */
export function ArchivedSessions({
  history,
  onOpen,
}: {
  history: SessionHistoryController
  onOpen: (session: SavedSessionSummary) => void
}) {
  const { t, locale } = useText()
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium" })
  return (
    <ScrollPanel>
      <SettingPage title={t("shell.session.archived")}>
        {history.loadError !== null ? (
          <p className="error-text" role="alert">
            {history.loadError}
          </p>
        ) : null}
        {history.loading && history.archived.length === 0 ? (
          <p role="status">{t("shell.session.loadHistory")}</p>
        ) : history.archived.length === 0 ? (
          <EmptyState title={t("shell.session.archivedEmpty")} />
        ) : (
          <SettingSection>
            {history.archived.map((session) => {
              const project = projectNameFromPath(session.projectPath ?? session.workspace)
              const timestamp = session.archivedAt ? Date.parse(session.archivedAt) : NaN
              const description = Number.isFinite(timestamp)
                ? `${project} · ${date.format(timestamp)}`
                : project
              return (
                <SettingRow
                  key={session.sessionId}
                  title={session.title || t("shell.session.untitled")}
                  description={description}
                >
                  <Button size="sm" variant="ghost" onClick={() => onOpen(session)}>
                    {t("shell.session.open")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void history.archive(session.sessionId, false)}
                  >
                    {t("shell.session.unarchive")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={!history.canDelete}
                    onClick={() => history.promptDeletion({ kind: "one", session })}
                  >
                    {t("shell.session.delete")}
                  </Button>
                </SettingRow>
              )
            })}
          </SettingSection>
        )}
      </SettingPage>
    </ScrollPanel>
  )
}
