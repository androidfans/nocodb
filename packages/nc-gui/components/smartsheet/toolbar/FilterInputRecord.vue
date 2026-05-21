<script lang="ts" setup>
import type { Select as AntSelect } from 'ant-design-vue'
import type { ColumnType, LinkToAnotherRecordType } from 'nocodb-sdk'
import { isDateOrDateTimeCol } from 'nocodb-sdk'
import dayjs from 'dayjs'

interface Props {
  modelValue?: string | null
  column?: ColumnType
  comparisonOp?: string
}

const props = defineProps<Props>()
const emit = defineEmits(['update:modelValue'])

const { $api } = useNuxtApp()
const { getMeta } = useMetas()
const { getValidSearchQueryForColumn } = useFieldQuery()

const column = toRef(props, 'column')

const isMulti = computed(() => ['in_id', 'nin_id'].includes(props.comparisonOp || ''))

const aselect = ref<typeof AntSelect>()
const isOpen = ref(false)
const searchVal = ref<string | null>()
const records = ref<{ pk: string; displayValue: string }[]>([])
const loading = ref(false)

const colOptions = computed(() => column.value?.colOptions as LinkToAnotherRecordType | undefined)

const relatedTableId = computed(() => colOptions.value?.fk_related_model_id)
const relatedBaseId = computed(() => (colOptions.value as any)?.fk_related_base_id || column.value?.base_id)

const selectedValue = computed({
  get: () => {
    if (!props.modelValue) return isMulti.value ? [] : undefined
    if (isMulti.value) {
      return String(props.modelValue).split(',').filter(Boolean)
    }
    return String(props.modelValue)
  },
  set: (val: string | string[] | undefined) => {
    if (isMulti.value) {
      const arr = Array.isArray(val) ? val : val ? [val] : []
      emit('update:modelValue', arr.length ? arr.join(',') : null)
    } else {
      const scalar = Array.isArray(val) ? val[0] : val
      emit('update:modelValue', scalar || null)
      isOpen.value = false
    }
  },
})

const displayValueColumnTitle = ref<string>('')
const displayValueColumn = ref<ColumnType | null>(null)
const pkColumn = ref<ColumnType | null>(null)
const pkColumnTitle = ref<string>('')
const relatedTableMeta = ref<any>(null)
const metaLoaded = ref(false)

async function loadRelatedTableMeta() {
  if (!relatedTableId.value || !relatedBaseId.value) return
  const meta = await getMeta(relatedBaseId.value, relatedTableId.value)
  if (!meta) return
  relatedTableMeta.value = meta

  const overrideId = (colOptions.value as any)?.fk_display_value_column_id
  const pvCol = overrideId
    ? (meta.columns || []).find((c: ColumnType) => c.id === overrideId) || (meta.columns || []).find((c: ColumnType) => c.pv)
    : (meta.columns || []).find((c: ColumnType) => c.pv)
  displayValueColumn.value = pvCol || (meta.columns || [])[0] || null
  displayValueColumnTitle.value = displayValueColumn.value?.title || ''

  const _pkCol = (meta.columns || []).find((c: ColumnType) => c.pk)
  pkColumn.value = _pkCol || null
  pkColumnTitle.value = _pkCol?.title || 'Id'
}

async function fetchRecords(search?: string) {
  if (!relatedTableId.value || !relatedBaseId.value || !metaLoaded.value) return
  loading.value = true
  try {
    let where: string | undefined
    if (search) {
      const clauses: string[] = []
      if (displayValueColumn.value) {
        if (isDateOrDateTimeCol(displayValueColumn.value)) {
          if (dayjs(search).isValid()) {
            clauses.push(`(${displayValueColumn.value.title},eq,exactDate,${search})`)
          }
        } else {
          const dvClause = getValidSearchQueryForColumn(displayValueColumn.value, search, relatedTableMeta.value, {
            getWhereQueryAs: 'string',
          }) as string
          if (dvClause) clauses.push(dvClause)
        }
      }
      if (pkColumn.value) {
        const pkClause = getValidSearchQueryForColumn(pkColumn.value, search, relatedTableMeta.value, {
          getWhereQueryAs: 'string',
        }) as string
        if (pkClause) clauses.push(pkClause)
      }
      where = clauses.length ? clauses.join('~or') : undefined
    }

    const res = await $api.dbDataTableRow.list(relatedTableId.value, {
      limit: 100,
      where,
      ...(displayValueColumnTitle.value ? { fields: [pkColumnTitle.value, displayValueColumnTitle.value].filter(Boolean) } : {}),
    })

    const rows = (res as any)?.list || []
    records.value = rows.map((row: Record<string, any>) => ({
      pk: String(row[pkColumnTitle.value] ?? row.Id ?? row.id ?? ''),
      displayValue: String(row[displayValueColumnTitle.value] ?? row[pkColumnTitle.value] ?? ''),
    }))

    mergeSelectedIntoOptions()

    if (search) {
      const searchLower = search.toLowerCase()
      records.value.sort((a, b) => {
        const aExactPk = a.pk === search
        const bExactPk = b.pk === search
        if (aExactPk && !bExactPk) return -1
        if (!aExactPk && bExactPk) return 1
        const aStartsWith = a.displayValue.toLowerCase().startsWith(searchLower)
        const bStartsWith = b.displayValue.toLowerCase().startsWith(searchLower)
        if (aStartsWith && !bStartsWith) return -1
        if (!aStartsWith && bStartsWith) return 1
        return 0
      })
    }
  } catch (e) {
    console.error('Failed to fetch records for filter', e)
  } finally {
    loading.value = false
  }
}

const pkToDisplayMap = ref<Map<string, string>>(new Map())

function mergeSelectedIntoOptions() {
  const loadedPks = new Set(records.value.map((r) => r.pk))
  for (const [pk, dv] of pkToDisplayMap.value) {
    if (!loadedPks.has(pk)) {
      records.value.push({ pk, displayValue: dv })
    }
  }
}

async function resolveSelectedDisplayValues() {
  const pks = props.modelValue ? String(props.modelValue).split(',').filter(Boolean) : []
  if (!pks.length || !relatedTableId.value || !relatedBaseId.value || !metaLoaded.value) return
  const unresolved = pks.filter((pk) => !pkToDisplayMap.value.has(pk))
  if (!unresolved.length) return

  try {
    const where = `(${pkColumnTitle.value},in,${unresolved.join(',')})`
    const res = await $api.dbDataTableRow.list(relatedTableId.value, {
      limit: unresolved.length,
      where,
      ...(displayValueColumnTitle.value ? { fields: [pkColumnTitle.value, displayValueColumnTitle.value].filter(Boolean) } : {}),
    })
    const rows = (res as any)?.list || []
    for (const row of rows) {
      const pk = String(row[pkColumnTitle.value] ?? row.Id ?? row.id ?? '')
      const dv = String(row[displayValueColumnTitle.value] ?? pk)
      pkToDisplayMap.value.set(pk, dv)
    }
    mergeSelectedIntoOptions()
  } catch (e) {
    console.error('Failed to resolve display values', e)
  }
}

function getDisplayLabel(pk: string) {
  return pkToDisplayMap.value.get(pk) || `#${pk}`
}

watch(
  () => props.modelValue,
  () => resolveSelectedDisplayValues(),
)

watch(
  relatedTableId,
  async () => {
    metaLoaded.value = false
    await loadRelatedTableMeta()
    metaLoaded.value = true
    await resolveSelectedDisplayValues()
    await fetchRecords()
  },
  { immediate: true },
)

watch(isOpen, (n) => {
  if (n) {
    searchVal.value = ''
    fetchRecords()
  }
})

const onSearch = useDebounceFn((val: string) => {
  fetchRecords(val || undefined)
}, 300)

const search = () => {
  const val = aselect.value?.$el?.querySelector('.ant-select-selection-search-input')?.value
  searchVal.value = val
  onSearch(val)
}
</script>

<template>
  <a-select
    ref="aselect"
    v-model:value="selectedValue"
    :mode="isMulti ? 'multiple' : undefined"
    class="w-full nc-filter-record-select"
    :placeholder="$t('general.select')"
    :open="isOpen"
    :loading="loading"
    show-search
    :filter-option="false"
    :allow-clear="true"
    @search="search"
    @dropdown-visible-change="(v: boolean) => (isOpen = v)"
  >
    <a-select-option v-for="record in records" :key="record.pk" :value="record.pk">
      <div class="flex items-center gap-1">
        <span class="truncate text-nc-content-brand font-medium">{{ record.displayValue }}</span>
      </div>
    </a-select-option>

    <template #tagRender="{ value: val, closable, onClose }">
      <span
        class="inline-flex items-center gap-1 border-1 border-nc-border-gray-medium rounded px-1.5 py-0.25 mr-0.5 my-0.25 text-xs text-nc-content-brand font-medium blue-chip max-w-32 truncate"
      >
        <span class="truncate">{{ getDisplayLabel(val) }}</span>
        <component
          :is="iconMap.closeThick"
          v-if="closable"
          class="text-gray-500 cursor-pointer hover:text-gray-700 w-3 h-3 flex-none"
          @click.stop="onClose"
        />
      </span>
    </template>
  </a-select>
</template>

<style lang="scss" scoped>
.nc-filter-record-select {
  :deep(.ant-select-selector) {
    @apply !min-h-8 flex items-center flex-wrap;
  }

  :deep(.ant-select-selection-item) {
    @apply !flex items-center gap-1 !border-1 !border-nc-border-gray-medium !rounded !bg-white !text-xs !text-nc-content-brand !font-medium !max-w-32;
  }
}

.blue-chip {
  @apply bg-white;
}
</style>
