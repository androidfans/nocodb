<script setup lang="ts">
import { UITypes, isLinksOrLTAR } from 'nocodb-sdk'
import type { ColumnType } from 'nocodb-sdk'
import SingleSelect from '~/components/cell/SingleSelect/index.vue'
import MultiSelect from '~/components/cell/MultiSelect/index.vue'
import DatePicker from '~/components/cell/Date/index.vue'
import YearPicker from '~/components/cell/Year/index.vue'
import TimePicker from '~/components/cell/Time/index.vue'
import Rating from '~/components/cell/Rating/index.vue'
import Duration from '~/components/cell/Duration/index.vue'
import Percent from '~/components/cell/Percent/index.vue'
import Currency from '~/components/cell/Currency/index.vue'
import Decimal from '~/components/cell/Decimal/index.vue'
import Integer from '~/components/cell/Integer/index.vue'
import Float from '~/components/cell/Float/index.vue'
import Text from '~/components/cell/Text/index.vue'
import User from '~/components/cell/User/index.vue'
import ColourFilter from '~/components/cell/Colour/FilterInput.vue'
import FilterInputRecord from '~/components/smartsheet/toolbar/FilterInputRecord.vue'

interface Props {
  // column could be possibly undefined when the filter is created
  column?: ColumnType
  filter: Filter
  disabled?: boolean
}

interface Emits {
  (event: 'updateFilterValue', model: any): void
}

const props = defineProps<Props>()

const emit = defineEmits<Emits>()

const RECORD_OPS = new Set(['eq_id', 'neq_id', 'in_id', 'nin_id'])

const rawColumn = toRef(props, 'column')
const columnRef = computed(() => getFilterInputColumn(rawColumn.value) as ColumnType | undefined)

const editEnabled = ref(true)

const readOnly = ref(props.filter.readOnly || props.disabled)

provide(ColumnInj, columnRef)

provide(EditModeInj, readonly(editEnabled))

provide(ReadonlyInj, readOnly)

const checkTypeFunctions: Record<string, (column: ColumnType, abstractType?: string) => boolean> = {
  isSingleSelect,
  isMultiSelect,
  isDate,
  isYear,
  isDateTime,
  isTime,
  isRating,
  isDuration,
  isPercent,
  isCurrency,
  isDecimal,
  isReadonlyDateTime,
  isInt,
  isFloat,
  isTextArea,
  isLinks: (col: ColumnType) => isLinksOrLTAR(col),
  isUser,
  isReadonlyUser,
  isColour,
}

type FilterType = keyof typeof checkTypeFunctions

const baseStore = useBase()

const sqlUi = computed(() => baseStore.getSqlUiBySourceId(columnRef.value?.source_id))

const abstractType = computed(() => columnRef.value && sqlUi.value?.getAbstractType(columnRef.value))

const checkType = (filterType: FilterType) => {
  const checkTypeFunction = checkTypeFunctions[filterType]

  if (!columnRef.value || !checkTypeFunction) {
    return false
  }

  return checkTypeFunction(columnRef.value, abstractType.value)
}

const filterInput = computed({
  get: () => {
    return props.filter.value
  },
  set: (value) => {
    emit('updateFilterValue', value)
  },
})

const booleanOptions = [
  { value: true, label: 'true' },
  { value: false, label: 'false' },
  { value: null, label: 'unset' },
]

const renderSingleSelect = (op: string) => {
  // use MultiSelect for SingleSelect columns for anyof / nanyof filters
  if (['anyof', 'nanyof'].includes(op)) {
    return MultiSelect
  }
  return SingleSelect
}

const renderDateFilterInput = (sub_op: string) => {
  if (['daysAgo', 'daysFromNow', 'pastNumberOfDays', 'nextNumberOfDays'].includes(sub_op)) {
    return Decimal
  }
  return DatePicker
}

const componentMap: Partial<Record<FilterType, any>> = computed(() => {
  return {
    isSingleSelect: renderSingleSelect(props.filter.comparison_op!),
    isMultiSelect: MultiSelect,
    isDate: renderDateFilterInput(props.filter.comparison_sub_op!),
    isYear: YearPicker,
    isDateTime: renderDateFilterInput(props.filter.comparison_sub_op!),
    isReadonlyDateTime: renderDateFilterInput(props.filter.comparison_sub_op!),
    isTime: TimePicker,
    isRating: Rating,
    isDuration: Duration,
    isPercent: Percent,
    isCurrency: Currency,
    isDecimal: Decimal,
    isInt: Integer,
    isFloat: Float,
    // Links & LTAR share this slot. The input component depends on
    // the operator and the concrete column type:
    //   - _id operators (eq_id, in_id, …) → record picker dropdown
    //   - Links (V2 OM/MM) non-_id (gt, lt, …) → Integer (count)
    //   - LTAR (V1 BT) non-_id (eq, like, …) → Text (display value)
    isLinks: RECORD_OPS.has(props.filter.comparison_op!)
      ? FilterInputRecord
      : columnRef.value?.uidt === UITypes.Links
      ? Integer
      : Text,
    isUser: User,
    isReadonlyUser: User,
    isColour: ColourFilter,
  }
})

const filterType = computed(() => {
  const result = Object.keys(componentMap.value).find((key) => checkType(key as FilterType))
  console.log('[FilterInput] filterType resolution:', {
    filterType: result,
    columnUidt: columnRef.value?.uidt,
    columnTitle: columnRef.value?.title,
    comparisonOp: props.filter.comparison_op,
    isRecordOp: RECORD_OPS.has(props.filter.comparison_op!),
    isLinksOrLTAR: columnRef.value ? isLinksOrLTAR(columnRef.value) : false,
    rawColumnUidt: rawColumn.value?.uidt,
    colOptions: columnRef.value?.colOptions,
    component: result ? componentMap.value[result]?.name || componentMap.value[result] : 'Text (fallback)',
  })
  return result
})

const componentProps = computed(() => {
  switch (filterType.value) {
    case 'isSingleSelect':
    case 'isMultiSelect': {
      return { disableOptionCreation: true, showReadonlyField: props.filter?.readOnly || props?.disabled }
    }
    case 'isPercent':
    case 'isDecimal':
    case 'isFloat':
    case 'isLinks': {
      // Record picker needs column meta to resolve the related table
      if (RECORD_OPS.has(props.filter.comparison_op!)) {
        return { column: columnRef.value, comparisonOp: props.filter.comparison_op }
      }
      // Links (V2 OM/MM) count input — fixed height like other numeric inputs
      if (columnRef.value?.uidt === UITypes.Links) {
        return { class: 'h-32px', showReadonlyField: props.filter?.readOnly || props?.disabled }
      }
      // LTAR (V1 BT) text input — no fixed height needed
      return { showReadonlyField: props.filter?.readOnly || props?.disabled }
    }
    case 'isInt': {
      return { class: 'h-32px', showReadonlyField: props.filter?.readOnly || props?.disabled }
    }
    case 'isDuration': {
      return { showValidationError: false, showReadonlyField: props.filter?.readOnly || props?.disabled }
    }
    case 'isUser': {
      return { forceMulti: true, showReadonlyField: props.filter?.readOnly || props?.disabled }
    }
    case 'isReadonlyUser': {
      if (['anyof', 'nanyof'].includes(props.filter.comparison_op!)) {
        return { forceMulti: true, showReadonlyField: props.filter?.readOnly || props?.disabled }
      }
      return {}
    }
    case 'isCurrency': {
      return { hidePrefix: true, showReadonlyField: props.filter?.readOnly || props?.disabled }
    }
    case 'isRating': {
      return {
        style: {
          minWidth: `${(columnRef.value?.meta?.max || 5) * 19}px`,
        },
        showReadonlyField: props.filter?.readOnly || props?.disabled,
      }
    }
    default: {
      return { showReadonlyField: props.filter?.readOnly || props?.disabled }
    }
  }
})

const hasExtraPadding = computed(() => {
  return (
    columnRef.value &&
    (isLinksOrLTAR(columnRef.value) ||
      isInt(columnRef.value, abstractType) ||
      isDate(columnRef.value, abstractType) ||
      isDateTime(columnRef.value, abstractType) ||
      isTime(columnRef.value, abstractType) ||
      isYear(columnRef.value, abstractType))
  )
})

const isInputBoxOnFocus = ref(false)

// provide the following to override the default behavior and enable input fields like in form
provide(ActiveCellInj, ref(true))
provide(IsFormInj, ref(true))

const isSingleOrMultiSelect = computed(() => {
  return filterType.value === 'isSingleSelect' || filterType.value === 'isMultiSelect' || filterType.value === 'isUser'
})
</script>

<template>
  <a-select
    v-if="columnRef && isBoolean(columnRef, abstractType)"
    v-model:value="filterInput"
    :disabled="filter.readOnly || props.disabled"
    :options="booleanOptions"
  />
  <div
    v-else
    class="bg-nc-bg-default border-1 flex flex-grow min-w-0 min-h-4 h-full px-1 items-center nc-filter-input-wrapper !rounded-lg"
    :class="{ 'px-2': hasExtraPadding, 'border-nc-border-brand': isInputBoxOnFocus, '!max-w-100': isSingleOrMultiSelect }"
    @mouseup.stop
  >
    <component
      :is="filterType ? componentMap[filterType] : Text"
      v-model="filterInput"
      :disabled="filter.readOnly || props.disabled"
      placeholder="Enter a value"
      :column="columnRef"
      class="flex !rounded-lg"
      :class="{
        'text-nc-content-gray-muted pointer-events-none': props.disabled,
      }"
      v-bind="componentProps"
      location="filter"
      @focus="isInputBoxOnFocus = true"
      @blur="isInputBoxOnFocus = false"
    />
  </div>
</template>

<style lang="scss" scoped>
:deep(input) {
  @apply py-1.5;
}

:deep(.ant-picker) {
  @apply !py-0;
}

:deep(.nc-cell-field) {
  @apply flex items-center;
}
</style>
