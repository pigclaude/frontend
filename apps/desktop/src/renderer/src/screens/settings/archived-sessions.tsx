// 负责归档管理的保留期和会话查找；打开归档时只查看保存的会话。

import { useState } from "react"
import {
  Button,
  EmptyState,
  SearchField,
  SettingPage,
  SettingRow,
  SettingSection,
} from "@pigclaude/ui-primitives"
import { ScrollPanel } from "@pigclaude/ui-shell"
import type { SessionHistoryController } from "../../hooks/use-session-history"
import { useText } from "../../locale/text"
import { projectNameFromPath } from "../../models/project-model"
import type { SavedSessionSummary } from "../../models/saved-session"
import { SessionRetentionSettings } from "./session-retention-settings"
import "../../styles/archive-management.css"

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
  const [query, setQuery] = useState("")
  const needle = query.trim().toLocaleLowerCase(locale)
  const sessions = history.archived.filter((session) =>
    [session.title, projectNameFromPath(session.projectPath ?? session.workspace)].some((text) =>
      text?.toLocaleLowerCase(locale).includes(needle),
    ),
  )
  return (
    <ScrollPanel>
      <SettingPage title={t("shell.session.archiveManagement")}>
        {history.loadError !== null ? (
          <p className="error-text" role="alert">
            {history.loadError}
          </p>
        ) : null}
        <SessionRetentionSettings history={history} />
        <SettingSection title={t("shell.session.archivedList")}>
          {history.archived.length > 0 ? (
            <SearchField
              className="archived-session-search"
              value={query}
              onValueChange={setQuery}
              placeholder={t("shell.session.archivedSearch")}
            />
          ) : null}
          {history.loading && history.archived.length === 0 ? (
            <p role="status">{t("shell.session.loadHistory")}</p>
          ) : sessions.length === 0 ? (
            <EmptyState
              title={t(needle ? "shell.session.archivedNoMatches" : "shell.session.archivedEmpty")}
            />
          ) : (
            sessions.map((session) => {
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
            })
          )}
        </SettingSection>
      </SettingPage>
    </ScrollPanel>
  )
}
