<script lang="ts" setup>
import { type ColumnType, type SortType, UITypesName } from 'nocodb-sdk'
import { UITypes, isColumnInError } from 'nocodb-sdk'
import rfdc from 'rfdc'
import { isSortFieldVisibleInToolbar } from '~/utils/sortUtils'

const props = defineProps<{
  // As we need to focus search box when the parent is opened
  isParentOpen: boolean
  sorts: SortType[]
}>()

const emits = defineEmits(['created'])

const { isParentOpen } = toRefs(props)

const clone = rfdc()

const { t } = useI18n()

const activeView = inject(ActiveViewInj, ref())

const meta = inject(MetaInj, ref())

const { isList } = useSmartsheetStoreOrThrow()

const listViewStore = isList.value ? useListViewStoreOrThrow() : undefined
const isListConfigured = computed(() => listViewStore?.isConfigured.value ?? false)

const { getMetaByKey } = useMetas()

const { showSystemFields, metaColumnById, fieldsMap } = useViewColumnsOrThrow(activeView, meta)

const levelTableColumns = computed(() => {
  if (!isList.value || !isListConfigured.value || !listViewStore?.selectedLevel.value) {
    return meta.value?.columns || []
  }
  const level = listViewStore.selectedLevel.value
  if (level.fk_model_id === meta.value?.id) {
    return meta.value?.columns || []
  }
  const tableMeta = getMetaByKey(meta.value?.base_id, level.fk_model_id)
  return tableMeta?.columns || []
})

const options = computed<ColumnType[]>(() =>
  (
    clone(levelTableColumns.value)
      ?.filter((c: ColumnType) =>
        isSortFieldVisibleInToolbar({
          column: c,
          meta: meta.value,
          metaColumnById: metaColumnById.value,
          showSystemFields: showSystemFields.value,
          fieldsMap: fieldsMap.value,
        }),
      )
      .filter((c: ColumnType) => !props.sorts?.find((s) => s.fk_column_id === c.id)) ?? []
  ).map((c) => {
    const isDisabled = [UITypes.QrCode, UITypes.Barcode, UITypes.ID, UITypes.Button].includes(c.uidt) || isColumnInError(c)

    if (isDisabled) {
      c.ncItemDisabled = true
      c.ncItemTooltip = isColumnInError(c)
        ? t('tooltip.sortingNotSupportedForFieldsWithErrors')
        : t('tooltip.sortingNotSupportedForField', { type: UITypesName[c.uidt] })
    }

    return c
  }),
)

const onClick = (column: ColumnType) => {
  emits('created', column)
}
</script>

<template>
  <div class="nc-sort-create-modal">
    <SmartsheetToolbarFieldListWithSearch
      :is-parent-open="isParentOpen"
      :search-input-placeholder="$t('msg.selectFieldToSort')"
      :options="options"
      toolbar-menu="sort"
      @selected="onClick"
    />
  </div>
</template>
