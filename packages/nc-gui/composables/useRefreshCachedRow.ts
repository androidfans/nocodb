import type { Ref } from 'vue'
import type { ColumnType, TableType, ViewType } from 'nocodb-sdk'
import type { Row } from '#imports'
import { validateRowFilters } from '~/utils/dataUtils'

interface UseRefreshCachedRowOptions {
  meta: Ref<TableType | undefined>
  view: Ref<ViewType | undefined>
  allFilters: Ref<any[]>
  validFiltersFromUrlParams: Ref<any[]>
  sorts: Ref<any[]>
}

interface RefreshCachedRowAdapter<TKey> {
  findRow: (rowId: string) => [TKey, Row] | undefined
  setRow: (key: TKey, row: Row) => void
  shouldApply?: () => boolean
}

export function useRefreshCachedRow({ meta, view, allFilters, validFiltersFromUrlParams, sorts }: UseRefreshCachedRowOptions) {
  const { $api } = useNuxtApp()
  const { metas } = useMetas()
  const { user } = useGlobal()
  const { getBaseType } = useBase()
  const { getEvaluatedRowMetaRowColorInfo } = useViewRowColorRender()

  const readRow = async (rowId: string) => {
    return await $api.dbTableRow.read(
      NOCO,
      (meta.value?.base_id || (view.value as any)?.base_id) as string,
      meta.value?.id as string,
      encodeURIComponent(rowId),
      {
        getHiddenColumn: true,
      },
    )
  }

  const buildRefreshedRow = (cachedRow: Row, record: Record<string, any>): Row => {
    const rowMeta = {
      ...cachedRow.rowMeta,
      ...getEvaluatedRowMetaRowColorInfo(record),
      isValidationFailed: !validateRowFilters(
        [...allFilters.value, ...validFiltersFromUrlParams.value],
        record,
        meta.value?.columns as ColumnType[],
        getBaseType((view.value as any)?.source_id),
        metas.value,
        meta.value?.base_id,
        {
          currentUser: user.value?.id ? { id: user.value.id, email: user.value.email } : undefined,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      ),
      isRowOrderUpdated:
        cachedRow.rowMeta?.isRowOrderUpdated ||
        sorts.value.some((sort) => {
          const title = meta.value?.columns?.find((col) => col.id === sort.fk_column_id)?.title
          return !!title && JSON.stringify(cachedRow.row[title]) !== JSON.stringify(record[title])
        }),
      isRlsHidden: !!record.__nc_rls_hidden,
    }
    delete rowMeta.ltarState

    return {
      ...cachedRow,
      row: record,
      oldRow: { ...record },
      rowMeta,
    }
  }

  const refreshCachedRow = async <TKey>(rowId: string | undefined, adapter: RefreshCachedRowAdapter<TKey>) => {
    if (!rowId || !meta.value?.id) return

    if (!adapter.findRow(rowId)) return

    const record = await readRow(rowId)

    if (adapter.shouldApply && !adapter.shouldApply()) return

    const latestRowEntry = adapter.findRow(rowId)
    if (!latestRowEntry) return

    const [rowKey, cachedRow] = latestRowEntry
    adapter.setRow(rowKey, buildRefreshedRow(cachedRow, record))
  }

  return {
    refreshCachedRow,
  }
}
