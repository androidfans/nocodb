<script lang="ts" setup>
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
    // Single select: toggle or replace
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
  <NcDropdown v-model:visible="isOpen" placement="bottomLeft">
    <!-- Trigger: chips display -->
    <div
      class="nc-filter-record-trigger flex items-center gap-1 min-h-8 px-2 py-1 border-1 border-nc-border-gray-medium rounded-lg cursor-pointer bg-nc-bg-default hover:border-nc-border-brand"
      :class="{ '!border-nc-border-brand': isOpen }"
      @click.stop
    >
      <div v-if="selectedPks.length" class="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
        <span
          v-for="pk in selectedPks"
          :key="pk"
          class="nc-filter-record-chip inline-flex items-center gap-0.5 bg-nc-bg-brand rounded-lg px-1.5 py-0.5 text-xs text-nc-content-brand font-medium flex-shrink-0 max-w-full"
        >
          <span class="truncate" :class="isMulti ? 'max-w-20' : 'max-w-40'">{{ getDisplayLabel(pk) }}</span>
          <component
            :is="iconMap.closeThick"
            class="text-nc-content-brand cursor-pointer hover:text-nc-content-brand-dark w-3 h-3 flex-none"
            @click.stop="removeRecord(pk)"
          />
        </span>
      </div>
      <span v-else class="text-nc-content-gray-muted text-sm flex-1">Select record</span>
      <div class="flex items-center gap-0.5 flex-none">
        <component
          :is="iconMap.closeThick"
          v-if="selectedPks.length"
          class="text-gray-400 cursor-pointer hover:text-gray-600 w-3.5 h-3.5"
          @click.stop="clearAll"
        />
        <component
          :is="iconMap.chevronDown"
          class="text-gray-400 w-4 h-4 transition-transform"
          :class="{ 'transform rotate-180': isOpen }"
        />
      </div>
    </div>

    <!-- Dropdown panel -->
    <template #overlay>
      <div class="nc-filter-record-panel bg-white rounded-lg shadow-lg border-1 border-gray-200 w-64 max-h-72 flex flex-col">
        <!-- Search input inside panel -->
        <div class="px-2 py-1.5 border-b-1 border-gray-100">
          <input
            ref="searchInputRef"
            :value="searchVal"
            class="w-full text-sm px-2 py-1 rounded bg-gray-50 border-1 border-gray-200 outline-none focus:border-nc-border-brand"
            placeholder="Search records..."
            @input="handleSearchInput"
          />
        </div>

        <!-- Record list -->
        <div class="flex-1 overflow-auto py-1">
          <div v-if="loading" class="flex items-center justify-center py-4">
            <a-spin size="small" />
          </div>
          <template v-else-if="records.length">
            <div
              v-for="record in records"
              :key="record.pk"
              class="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-gray-50 text-sm"
              @click.stop="toggleRecord(record.pk)"
            >
              <div
                class="w-4 h-4 rounded border-1 flex items-center justify-center flex-none"
                :class="
                  selectedPks.includes(record.pk)
                    ? 'bg-nc-fill-brand border-nc-border-brand'
                    : 'border-gray-300'
                "
              >
                <component
                  :is="iconMap.check"
                  v-if="selectedPks.includes(record.pk)"
                  class="text-white w-3 h-3"
                />
              </div>
              <span class="truncate text-nc-content-gray">{{ record.displayValue }}</span>
            </div>
          </template>
          <div v-else class="px-3 py-4 text-center text-sm text-gray-400">
            No records found
          </div>
        </div>
      </div>
    </template>
  </NcDropdown>
</template>

<style lang="scss" scoped>
.nc-filter-record-trigger {
  min-width: 10rem;
}
</style>
