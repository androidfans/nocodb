<script lang="ts" setup>
import { type ColumnType } from 'nocodb-sdk'

const props = defineProps<{
  fields: ColumnType[]
  hiddenFields: ColumnType[]
  isLoading: boolean
  isWideLayout?: boolean
  forceVerticalMode?: boolean
}>()

const isLoading = toRef(props, 'isLoading')

const { loadRow: _loadRow, row: _row } = useExpandedFormStoreOrThrow()

const { isMobileMode } = useGlobal()

const showHiddenFields = ref(false)
</script>

<template>
  <div
    ref="expandedFormScrollWrapper"
    class="flex flex-col flex-grow gap-5 h-full max-h-full nc-scrollbar-thin w-full py-4 xs:(pt-4 pb-2 gap-6)"
    :class="
      props.isWideLayout
        ? 'items-start px-8 xs:px-6 children:w-full children:max-w-none'
        : 'items-center p-4 xs:px-4 children:max-w-[588px] <lg:(children:max-w-[450px])'
    "
  >
    <SmartsheetExpandedFormPresentorsFieldsColumnList
      :fields="fields"
      :force-vertical-mode="forceVerticalMode"
      :is-loading="isLoading"
      :is-wide-layout="props.isWideLayout"
    />
    <div v-if="hiddenFields.length > 0" class="flex w-full <lg:(px-1) items-center py-6">
      <div class="flex-grow h-px mr-1 bg-nc-bg-gray-light" />
      <NcButton
        :size="isMobileMode ? 'medium' : 'small'"
        class="flex-shrink !text-sm overflow-hidden !text-nc-content-gray-muted !font-weight-500"
        type="secondary"
        @click="showHiddenFields = !showHiddenFields"
      >
        {{ showHiddenFields ? `Hide ${hiddenFields.length} hidden` : `Show ${hiddenFields.length} hidden` }}
        {{ hiddenFields.length > 1 ? `fields` : `field` }}
        <GeneralIcon icon="chevronDown" :class="showHiddenFields ? 'transform rotate-180' : ''" class="ml-1" />
      </NcButton>
      <div class="flex-grow h-px ml-1 bg-nc-bg-gray-light" />
    </div>
    <SmartsheetExpandedFormPresentorsFieldsColumnList
      v-if="hiddenFields.length > 0 && showHiddenFields"
      :fields="hiddenFields"
      is-hidden-col
      :force-vertical-mode="forceVerticalMode"
      :is-loading="isLoading"
      :is-wide-layout="props.isWideLayout"
      :show-col-callback="(col) => isFormula(col)"
    />
  </div>
</template>
