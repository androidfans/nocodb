<script lang="ts" setup>
import type { Select as AntSelect } from 'ant-design-vue'
import type { ColumnType, LinkToAnotherRecordType } from 'nocodb-sdk'

interface Props {
  modelValue?: string | null
  column?: ColumnType
  comparisonOp?: string
}

const props = defineProps<Props>()
const emit = defineEmits(['update:modelValue'])

const { $api } = useNuxtApp()
const { getMeta } = useMetas()

const column = toRef(props, 'column')

const isMulti = computed(() => ['in_id', 'nin_id'].includes(props.comparisonOp || ''))

const aselect = ref<typeof AntSelect>()
const isOpen = ref(false)
const searchVal = ref<string | null>()
const records = ref<{ pk: string; displayValue: string }[]>([])
const loading = ref(false)

const colOptions = computed(() => column.value?.colOptions as LinkToAnotherRecordType | undefined)

const relatedTableId = computed(() => colOptions.value?.fk_related_model_id)

const selectedPks = computed<string[]>({
  get: () => {
    if (!props.modelValue) return []
    return props.modelValue.split(',').filter(Boolean)
  },
  set: (val: string[]) => {
    if (isMulti.value) {
      emit('update:modelValue', val.length ? val.join(',') : null)
    } else {
      emit('update:modelValue', val.length ? val[val.length - 1] : null)
      isOpen.value = false
    }
  },
})

const displayValueColumnTitle = ref<string>('')
const pkColumnTitle = ref<string>('')

async function loadRelatedTableMeta() {
  if (!relatedTableId.value || !column.value?.base_id) return
  const meta = await getMeta(column.value.base_id, relatedTableId.value)
  if (!meta) return

  const pvCol = (meta.columns || []).find((c: ColumnType) => c.pv)
  displayValueColumnTitle.value = pvCol?.title || (meta.columns || [])[0]?.title || ''

  const pkCol = (meta.columns || []).find((c: ColumnType) => c.pk)
  pkColumnTitle.value = pkCol?.title || 'Id'
}

async function fetchRecords(search?: string) {
  if (!relatedTableId.value || !column.value?.base_id) return
  loading.value = true
  try {
    const where = search
      ? `(${displayValueColumnTitle.value},like,%${search}%)`
      : undefined

    const res = await $api.dbDataTableRow.list(column.value.base_id, relatedTableId.value, {
      limit: 100,
      where,
      ...(displayValueColumnTitle.value ? { fields: [pkColumnTitle.value, displayValueColumnTitle.value].filter(Boolean) } : {}),
    })

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
    loading.value = false
  }
}

const pkToDisplayMap = ref<Map<string, string>>(new Map())

async function resolveSelectedDisplayValues() {
  if (!selectedPks.value.length || !relatedTableId.value || !column.value?.base_id) return
  const unresolved = selectedPks.value.filter((pk) => !pkToDisplayMap.value.has(pk))
  if (!unresolved.length) return

  try {
    const where = `(${pkColumnTitle.value},in,${unresolved.join(',')})`
    const res = await $api.dbDataTableRow.list(column.value.base_id, relatedTableId.value, {
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

onMounted(async () => {
  await loadRelatedTableMeta()
  await resolveSelectedDisplayValues()
  await fetchRecords()
})

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
    v-model:value="selectedPks"
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
        <span class="truncate">{{ record.displayValue }}</span>
        <span class="text-nc-content-gray-muted text-xs">#{{ record.pk }}</span>
      </div>
    </a-select-option>

    <template #tagRender="{ value: val, closable, onClose }">
      <a-tag :closable="closable" class="nc-filter-record-tag" @close="onClose">
        {{ getDisplayLabel(val) }}
      </a-tag>
    </template>
  </a-select>
</template>

<style lang="scss" scoped>
.nc-filter-record-select {
  :deep(.ant-select-selector) {
    @apply !min-h-8;
  }
}

.nc-filter-record-tag {
  @apply flex items-center gap-1 max-w-40 truncate;
}
</style>
