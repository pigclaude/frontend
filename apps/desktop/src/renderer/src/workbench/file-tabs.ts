// 负责文件标签的状态变化：目录导航单击复用预览标签，显式打开、双击或编辑后固定，有草稿的标签标出未保存。
import {
  FILE_SURFACE_KIND,
  openFileSurface,
  updateSurface,
  type PanelSurface,
  type PanelSurfaceState,
} from "@pigclaude/ui-workbench"

/**
 * 从目录导航打开文件。preview 时替换没有草稿的预览标签；从「文件」标签打开时在它的位置打开，
 * 所以「文件」标签变成文件标签。文件已经打开时只切换过去，显式打开会把它的预览固定下来。
 */
export function openNavigationFile(
  state: PanelSurfaceState,
  path: string,
  id: string,
  { preview, hasDraft }: { preview: boolean; hasDraft: (path: string) => boolean },
): PanelSurfaceState {
  const source = state.surfaces.find((surface) => surface.id === state.activeId)
  const currentPreview = state.surfaces.find((surface) => surface.preview)
  const alreadyOpen = state.surfaces.some(
    (surface) => surface.kind === FILE_SURFACE_KIND && surface.path === path,
  )
  const replace =
    preview && !alreadyOpen && currentPreview?.path && !hasDraft(currentPreview.path)
      ? currentPreview.id
      : source?.kind === "files"
        ? source.id
        : undefined
  return openFileSurface(state, path, id, { replace, preview })
}

/** 把预览标签固定为普通标签；不是预览标签时原样返回。 */
export function keepSurface(state: PanelSurfaceState, id: string): PanelSurfaceState {
  const surface = state.surfaces.find((item) => item.id === id)
  return surface?.preview ? updateSurface(state, id, { preview: false }) : state
}

/** 按草稿标出文件标签是否未保存，标签栏据此显示圆点。 */
export function markUnsaved(
  surfaces: readonly PanelSurface[],
  hasDraft: (path: string) => boolean,
): PanelSurface[] {
  return surfaces.map((surface) =>
    surface.kind === FILE_SURFACE_KIND && surface.path
      ? { ...surface, dirty: hasDraft(surface.path) }
      : surface,
  )
}
