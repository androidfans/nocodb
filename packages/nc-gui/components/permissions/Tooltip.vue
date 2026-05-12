<script lang="ts" setup>
import type { PermissionEntity, PermissionKey } from 'nocodb-sdk'
import type { TooltipPlacement } from 'ant-design-vue/lib/tooltip'

interface Props {
  entity: PermissionEntity
  entityId?: string // required for permission check otherwise it will always return true
  permission: PermissionKey
  title?: string
  description?: string
  placement?: TooltipPlacement
  showIcon?: boolean
  showOverlay?: boolean
  defaultTooltip?: string
  showPointerEventNone?: boolean
  disabled?: boolean
  arrow?: boolean
}

defineProps<Props>()
// 这个组件是 slot-only（根节点不是一个会自动继承 attrs 的普通元素），
// 之前父组件传 class 会触发 Vue 的 “Extraneous non-props attributes” 警告。
// 显式关闭 inheritAttrs，避免开发态噪音并保持行为可预期。
defineOptions({
  inheritAttrs: false,
})

const isAllowed = computed(() => true)
</script>

<template>
  <slot :is-allowed="isAllowed" />
</template>
