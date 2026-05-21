import type { ColumnType, LinkToAnotherRecordType, TableType, ViewType } from 'nocodb-sdk'
import type { UseExpandedFormDetachedProps } from './useExpandedFormDetached'

interface UseExpandedFormSiblingNavigationOptions {
  state: UseExpandedFormDetachedProps
  siblings: Record<string, any>[]
  columns: ColumnType[]
}

export function getRelatedRecordView(
  column: ColumnType | undefined | null,
  relatedTableMeta: TableType | undefined | null,
): ViewType | undefined {
  const colOptions = (column?.colOptions ?? {}) as LinkToAnotherRecordType & { fk_target_view_id?: string | null }
  const views = relatedTableMeta?.views ?? []

  return (colOptions.fk_target_view_id ? views.find((view) => view.id === colOptions.fk_target_view_id) : undefined) ?? views[0]
}

// Shared by DOM chips and canvas chips so detached expanded forms navigate the
// same sibling list regardless of which LTAR renderer opened them.
export function useExpandedFormSiblingNavigation({ state, siblings, columns }: UseExpandedFormSiblingNavigationOptions) {
  const updateSiblingState = (nextIndex: number) => {
    const nextItem = siblings[nextIndex]
    const nextRowId = nextItem ? extractPkFromRow(nextItem, columns) : undefined
    if (!nextItem || !nextRowId) return false

    state.row = { row: nextItem, rowMeta: {}, oldRow: { ...nextItem } }
    state.rowId = nextRowId
    state.firstRow = nextIndex === 0
    state.lastRow = nextIndex === siblings.length - 1

    return true
  }

  const findCurrentSiblingIndex = () => {
    const currentIndex = siblings.findIndex((sibling) => extractPkFromRow(sibling, columns) === state.rowId)
    return currentIndex === -1 ? 0 : currentIndex
  }

  const navigateSibling = (dir: 1 | -1) => {
    return updateSiblingState(findCurrentSiblingIndex() + dir)
  }

  return {
    updateSiblingState,
    findCurrentSiblingIndex,
    navigateSibling,
  }
}
