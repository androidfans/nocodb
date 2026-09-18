<script setup lang="ts">
import { type ColumnType, UITypes, isVirtualCol } from 'nocodb-sdk'

const props = defineProps<{ value: ColumnType }>()
const emit = defineEmits(['update:value'])
const vModel = useVModel(props, 'value', emit)

const { sqlUi, onAlter, isSystem, isSyncedField } = useColumnCreateStoreOrThrow()

// Expose the existing NN constraint without unlocking the other advanced DB options.
// Virtual/attachment fields and DB-generated types do not use this ordinary-field control.
const supported = computed(
  () =>
    !!vModel.value.uidt &&
    !isVirtualCol(vModel.value) &&
    ![UITypes.Attachment, UITypes.UUID, UITypes.AutoNumber].includes(vModel.value.uidt as UITypes),
)

const disabled = computed(
  () => !!vModel.value.pk || isSystem.value || isSyncedField.value || !sqlUi.value.columnEditable(vModel.value),
)

const setRequired = (value: boolean) => {
  if (disabled.value) return
  vModel.value.rqd = value
  // onAlter takes a numeric alteration marker, not the switch's boolean value.
  onAlter()
}
</script>

<template>
  <div v-if="supported" class="flex">
    <NcTooltip
      title="Requires a non-NULL value in every record. Fill existing NULL values before enabling. Empty strings are not rejected."
      placement="right"
    >
      <NcSwitch :checked="!!vModel.rqd" :disabled="disabled" size="small" data-testid="nc-column-required" @change="setRequired">
        <span class="text-sm text-nc-content-gray">{{ $t('general.required') }}</span>
      </NcSwitch>
    </NcTooltip>
  </div>
</template>
