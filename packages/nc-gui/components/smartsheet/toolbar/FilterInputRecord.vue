<script lang="ts" setup>
import type { ColumnType, LinkToAnotherRecordType } from 'nocodb-sdk'
import { isDateOrDateTimeCol } from 'nocodb-sdk'
import dayjs from 'dayjs'

interface Props {
  modelValue?: string | null
  column?: ColumnType
  comparisonOp?: string
  disabled?: boolean
}

const props = defineProps<Props>()
const emit = defineEmits(['update:modelValue'])

const { $api } = useNuxtApp()
const { getMeta } = useMetas()
const { getValidSearchQueryForColumn } = useFieldQuery()

const column = toRef(props, 'column')

const isMulti = computed(() => ['in_id', 'nin_id'].includes(props.comparisonOp || ''))

const isOpen = ref(false)
const searchVal = ref('')
const records = ref<{ pk: string; displayValue: string }[]>([])
const loading = ref(false)
let fetchRequestId = 0
const searchInputRef = ref<HTMLInputElement>()

const colOptions = computed(() => column.value?.colOptions as LinkToAnotherRecordType | undefined)
const relatedTableId = computed(() => colOptions.value?.fk_related_model_id)
const relatedBaseId = computed(() => (colOptions.value as any)?.fk_related_base_id || column.value?.base_id)

const selectedPks = computed<string[]>(() => {
  if (!props.modelValue) return []
  return String(props.modelValue).split(',').filter(Boolean)
})

function toggleRecord(pk: string) {
  if (isMulti.value) {
    const current = [...selectedPks.value]
    const idx = current.indexOf(pk)
    if (idx >= 0) {
      current.splice(idx, 1)
    } else {
      current.push(pk)
    }
    emit('update:modelValue', current.length ? current.join(',') : null)
  } else {
    if (selectedPks.value[0] === pk) {
      emit('update:modelValue', null)
    } else {
      emit('update:modelValue', pk)
    }
    isOpen.value = false
  }
}

function removeRecord(pk: string) {
  const current = selectedPks.value.filter((p) => p !== pk)
  emit('update:modelValue', current.length ? current.join(',') : null)
}

function clearAll() {
  emit('update:modelValue', null)
}

const displayValueColumnTitle = ref<string>('')
const displayValueColumn = ref<ColumnType | null>(null)
const pkColumn = ref<ColumnType | null>(null)
const pkColumnTitle = ref<string>('')
const relatedTableMeta = ref<any>(null)
const metaLoaded = ref(false)

async function loadRelatedTableMeta() {
  relatedTableMeta.value = null
  displayValueColumn.value = null
  displayValueColumnTitle.value = ''
  pkColumn.value = null
  pkColumnTitle.value = ''

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
  const requestId = ++fetchRequestId
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
            serializeLinkRecordSearchQuery: true,
          }) as string
          if (dvClause) clauses.push(dvClause)
        }
      }
      if (pkColumn.value && /^\d+$/.test(search)) {
        const pkClause = getValidSearchQueryForColumn(pkColumn.value, search, relatedTableMeta.value, {
          getWhereQueryAs: 'string',
          serializeLinkRecordSearchQuery: true,
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

    if (requestId !== fetchRequestId) return

    const rows = (res as any)?.list || []
    records.value = rows.map((row: Record<string, any>) => ({
      pk: String(row[pkColumnTitle.value] ?? row.Id ?? row.id ?? ''),
      displayValue: String(row[displayValueColumnTitle.value] ?? row[pkColumnTitle.value] ?? ''),
    }))

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
    if (requestId === fetchRequestId) {
      loading.value = false
    }
  }
}

const pkToDisplayMap = ref<Map<string, string>>(new Map())

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
  [relatedBaseId, relatedTableId],
  async () => {
    metaLoaded.value = false
    records.value = []
    pkToDisplayMap.value = new Map()
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
    nextTick(() => searchInputRef.value?.focus())
  }
})

const onSearch = useDebounceFn((val: string) => {
  fetchRecords(val || undefined)
}, 300)

const handleSearchInput = (e: Event) => {
  const val = (e.target as HTMLInputElement).value
  searchVal.value = val
  onSearch(val)
}
</script>

<template>
  <NcDropdown v-model:visible="isOpen" :disabled="props.disabled" placement="bottomLeft">
    <!-- Trigger: fixed-width button with chips, overflow hidden -->
    <div class="nc-filter-record-trigger group" :class="{ 'is-open': isOpen, 'is-disabled': props.disabled }" @click.stop>
      <div class="trigger-chips">
        <template v-if="selectedPks.length">
          <span v-for="pk in selectedPks" :key="pk" class="nc-record-chip">
            <span class="truncate">{{ getDisplayLabel(pk) }}</span>
            <component :is="iconMap.closeThick" v-if="!props.disabled" class="chip-close" @click.stop="removeRecord(pk)" />
          </span>
        </template>
        <span v-else class="trigger-placeholder">Select record</span>
      </div>
      <div class="trigger-actions">
        <component
          :is="iconMap.close"
          v-if="selectedPks.length && !props.disabled"
          class="action-icon clear-icon"
          @click.stop="clearAll"
        />
        <component :is="iconMap.chevronDown" class="action-icon chevron-icon" :class="{ 'rotate-180': isOpen }" />
      </div>
    </div>

    <!-- Dropdown panel -->
    <template #overlay>
      <div class="nc-filter-record-panel">
        <!-- Search -->
        <div class="panel-search">
          <input
            ref="searchInputRef"
            :value="searchVal"
            class="search-input"
            placeholder="Search records..."
            @input="handleSearchInput"
          />
        </div>

        <!-- Record list -->
        <div class="panel-list">
          <div v-if="loading" class="panel-empty">
            <a-spin size="small" />
          </div>
          <template v-else-if="records.length">
            <div
              v-for="record in records"
              :key="record.pk"
              class="record-item"
              :class="{ 'is-selected': selectedPks.includes(record.pk) }"
              @click.stop="toggleRecord(record.pk)"
            >
              <NcCheckbox :checked="selectedPks.includes(record.pk)" size="small" class="!-mt-0" />
              <span class="record-label">{{ record.displayValue }}</span>
            </div>
          </template>
          <div v-else class="panel-empty">No records found</div>
        </div>
      </div>
    </template>
  </NcDropdown>
</template>

<style lang="scss" scoped>
.nc-filter-record-trigger {
  @apply flex items-center justify-between gap-1 min-h-8 w-56 px-2 py-0.5
    rounded-lg cursor-pointer border-1 border-nc-border-gray-medium
    bg-nc-bg-default hover:bg-nc-bg-gray-extralight transition-colors overflow-hidden;

  &.is-open {
    @apply bg-nc-bg-gray-extralight border-nc-border-gray-medium;
  }

  &.is-disabled {
    @apply opacity-60 cursor-not-allowed;
  }
}

.trigger-chips {
  @apply flex items-center gap-1 flex-1 min-w-0 overflow-hidden;
}

.nc-record-chip {
  @apply inline-flex items-center gap-0.5 flex-shrink-0
    bg-nc-bg-brand rounded-lg px-1.5 py-0.5 text-xs
    text-nc-content-brand font-medium max-w-28;
}

.chip-close {
  @apply text-nc-content-brand cursor-pointer w-3 h-3 flex-none
    opacity-0 group-hover:opacity-100 transition-opacity;
}

.trigger-placeholder {
  @apply text-nc-content-gray-muted text-sm;
}

.trigger-actions {
  @apply flex items-center gap-0.5 flex-none;
}

.action-icon {
  @apply text-nc-content-gray-muted w-3.5 h-3.5 transition-transform;
}

.clear-icon {
  @apply cursor-pointer hover:text-nc-content-gray;
}

.nc-filter-record-panel {
  @apply bg-nc-bg-default rounded-lg shadow-lg
    border-1 border-nc-border-gray-medium
    w-80 max-h-72 flex flex-col;
}

.panel-search {
  @apply px-2 py-1.5 border-b-1 border-nc-border-gray-light;
}

.search-input {
  @apply w-full text-sm px-2 py-1 rounded
    bg-nc-bg-gray-extralight border-1 border-nc-border-gray-medium
    text-nc-content-gray outline-none focus:border-nc-border-brand;
}

.panel-list {
  @apply flex-1 overflow-auto py-1;
}

.record-item {
  @apply flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm
    hover:bg-nc-bg-gray-extralight transition-colors;

  &.is-selected {
    @apply bg-nc-bg-brand/5;
  }
}

.record-label {
  @apply truncate text-nc-content-gray;
}

.panel-empty {
  @apply flex items-center justify-center py-4 text-sm text-nc-content-gray-muted;
}
</style>
