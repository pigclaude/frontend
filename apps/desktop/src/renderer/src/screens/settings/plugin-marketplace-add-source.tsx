// 收集固定提交、带校验值的 HTTPS 归档或从主进程选取的开发目录。

import { useId, useState, type ComponentProps, type FormEvent } from "react"
import { FolderOpen } from "lucide-react"
import { Button, Dialog, Input, SegmentedControl } from "@pigclaude/ui-primitives"
import type { PluginMarketplaceSourceInput } from "../../../../plugin-marketplace-contract"
import { useText, type TextKey } from "../../locale/text"
import {
  marketplaceErrorKey,
  marketplaceSourceLabels,
  marketplaceSourcePin,
} from "./plugin-marketplace-view"

type SourceKind = PluginMarketplaceSourceInput["kind"]

/** 只在当前类型的必需字段有效时提交；开发目录必须经过原生选择器。 */
export function PluginMarketplaceAddSource({
  developerMode,
  busy,
  error,
  selectDirectory,
  onClose,
  onAdd,
}: {
  developerMode: boolean
  busy: boolean
  error: string | null
  selectDirectory: () => Promise<string | null>
  onClose: () => void
  onAdd: (input: PluginMarketplaceSourceInput) => void
}) {
  const { t } = useText()
  const [kind, setKind] = useState<SourceKind>("github")
  const [repo, setRepo] = useState("")
  const [commit, setCommit] = useState("")
  const [url, setUrl] = useState("")
  const [sha256, setDigest] = useState("")
  const [directory, setDirectory] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState<TextKey | null>(null)
  const [selecting, setSelecting] = useState(false)
  const directoryId = useId()
  const disabled = selecting || busy
  const available: SourceKind[] = developerMode
    ? ["github", "https", "directory"]
    : ["github", "https"]
  const selected = kind === "directory" && !developerMode ? "github" : kind
  const input = validSource({ selected, repo, commit, url, sha256, directory })
  const issue = selectionError ? t(selectionError) : error

  async function pickDirectory(): Promise<void> {
    if (disabled) return
    setSelecting(true)
    setSelectionError(null)
    try {
      const path = await selectDirectory()
      if (path !== null) setDirectory(path)
    } catch (cause: unknown) {
      setSelectionError(marketplaceErrorKey(cause))
    } finally {
      setSelecting(false)
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (input !== null && !disabled) onAdd(input)
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && !disabled && onClose()}>
      <Dialog.Content
        className="marketplace-dialog"
        title={t("pluginMarketplace.addSource")}
        closeLabel={t("pluginSettings.close")}
        closeDisabled={disabled}
      >
        <form onSubmit={submit}>
          <Dialog.Body>
            <SegmentedControl<SourceKind>
              aria-label={t("pluginMarketplace.sourceKind")}
              options={available.map((value) => ({
                value,
                label: t(marketplaceSourceLabels[value]),
              }))}
              value={selected}
              disabled={disabled}
              onValueChange={(next) => {
                setKind(next)
                setSelectionError(null)
              }}
            />
            {selected === "github" ? (
              <>
                <SourceField
                  label={t("pluginMarketplace.repo")}
                  value={repo}
                  disabled={disabled}
                  placeholder="owner/repository"
                  onValueChange={setRepo}
                />
                <SourceField
                  label={t("pluginMarketplace.commit")}
                  value={commit}
                  disabled={disabled}
                  placeholder={t("pluginMarketplace.commitPlaceholder")}
                  maxLength={40}
                  onValueChange={setCommit}
                />
              </>
            ) : selected === "https" ? (
              <>
                <SourceField
                  label={t("pluginMarketplace.url")}
                  value={url}
                  type="url"
                  disabled={disabled}
                  placeholder="https://example.com/marketplace.tgz"
                  onValueChange={setUrl}
                />
                <SourceField
                  label={t("pluginMarketplace.sha256")}
                  value={sha256}
                  disabled={disabled}
                  placeholder={t("pluginSettings.digestPlaceholder")}
                  maxLength={64}
                  onValueChange={setDigest}
                />
              </>
            ) : (
              <div className="field">
                <label className="label" htmlFor={directoryId}>
                  {t("pluginMarketplace.directoryPath")}
                </label>
                <div className="install-dialog-input">
                  <Input id={directoryId} className="mono" readOnly value={directory ?? ""} />
                  <Button
                    type="button"
                    size="sm"
                    disabled={disabled}
                    onClick={() => void pickDirectory()}
                  >
                    <FolderOpen className="ic ic-sm" aria-hidden="true" />
                    {t("pluginMarketplace.selectDirectory")}
                  </Button>
                </div>
              </div>
            )}
            {issue ? (
              <p className="error-text" role="alert">
                {issue}
              </p>
            ) : null}
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Close render={<Button type="button" variant="ghost" disabled={disabled} />}>
              {t("pluginSettings.cancel")}
            </Dialog.Close>
            <Button type="submit" variant="primary" disabled={disabled || input === null}>
              {t(busy ? "pluginMarketplace.pendingAdd" : "pluginMarketplace.addSource")}
            </Button>
          </Dialog.Footer>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}

function SourceField({
  label,
  onValueChange,
  ...props
}: Omit<ComponentProps<typeof Input>, "onChange"> & {
  label: string
  onValueChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div className="field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <Input
        {...props}
        id={id}
        className="mono"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => onValueChange(event.target.value)}
      />
    </div>
  )
}

function validSource(input: {
  selected: SourceKind
  repo: string
  commit: string
  url: string
  sha256: string
  directory: string | null
}): PluginMarketplaceSourceInput | null {
  const { selected, directory } = input
  if (selected === "directory") return directory ? { kind: selected, path: directory } : null
  if (selected === "github") {
    const repo = input.repo.trim()
    const commit = marketplaceSourcePin(selected, input.commit)
    return repo && commit ? { kind: selected, repo, commit } : null
  }
  const url = input.url.trim()
  const sha256 = marketplaceSourcePin(selected, input.sha256)
  return /^https:\/\/\S+$/i.test(url) && sha256 ? { kind: selected, url, sha256 } : null
}
