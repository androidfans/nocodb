<script setup lang="ts">
import type { TableType } from 'nocodb-sdk'
import type { SortableEvent } from 'sortablejs'
import Sortable from 'sortablejs'

const { isUIAllowed } = useRoles()

const { $api } = useNuxtApp()

const { isMobileMode } = useGlobal()

const { base, isSharedBase } = storeToRefs(useBase())

const tablesStore = useTablesStore()
const { activeTable, activeTables } = storeToRefs(tablesStore)
const { openTable } = tablesStore

const { isLeftSidebarOpen } = storeToRefs(useSidebarStore())

const filteredTables = computed(() => {
  return activeTables.value.filter((t: TableType) => t?.source_id === activeTable.value?.source_id) || []
})

const tableListRef = ref<HTMLElement>()
let sortable: Sortable | undefined

const handleNavigateToTable = (table: TableType) => {
  if (!table?.id || table.id === activeTable.value?.id) return
  openTable(table)
}

function computeNewOrder(evt: SortableEvent, newIndex: number): number | null {
  const children: HTMLCollection = evt.to.children
  if (children.length <= 1) return 1

  const itemBeforeEl = children[newIndex - 1] as HTMLElement | undefined
  const itemAfterEl = children[newIndex + 1] as HTMLElement | undefined

  const itemBefore = itemBeforeEl && filteredTables.value.find((t) => t.id === itemBeforeEl.dataset.id)
  const itemAfter = itemAfterEl && filteredTables.value.find((t) => t.id === itemAfterEl.dataset.id)

  if (children.length - 1 === newIndex) {
    return (itemBefore?.order ?? 0) + 1
  } else if (newIndex === 0) {
    return (itemAfter?.order ?? 1) / 2
  } else {
    return ((itemBefore?.order ?? 0) + (itemAfter?.order ?? 0)) / 2
  }
}

const initSortable = (el: HTMLElement) => {
  if (isMobileMode.value) return
  if (sortable) sortable.destroy()

  sortable = Sortable.create(el, {
    direction: 'horizontal',
    ghostClass: 'nc-table-tab-ghost',
    animation: 150,
    revertOnSpill: true,
    onEnd: async (evt) => {
      const { newIndex = 0, oldIndex = 0 } = evt
      if (newIndex === oldIndex) return

      const itemEl = evt.item as HTMLElement
      const currentItem = filteredTables.value.find((t) => t.id === itemEl.dataset.id)
      if (!currentItem?.id) return

      const newOrder = computeNewOrder(evt, newIndex)
      if (newOrder == null) return
      currentItem.order = newOrder

      const sourceId = currentItem.source_id
      const offset = activeTables.value.findIndex((t) => t?.source_id === sourceId)
      if (offset !== -1) {
        activeTables.value.splice(newIndex + offset, 0, ...activeTables.value.splice(oldIndex + offset, 1))
      }

      try {
        await $api.internal.postOperation(
          currentItem.fk_workspace_id!,
          currentItem.base_id!,
          {
            operation: 'tableReorder',
            tableId: currentItem.id,
          },
          {
            order: currentItem.order,
          },
        )
      } catch (e: any) {
        message.error(await extractSdkResponseErrorMsg(e))
      }
    },
    ...getDraggableAutoScrollOptions({ scrollSensitivity: 50 }),
  })
}

watchEffect(() => {
  if (tableListRef.value && isUIAllowed('viewCreateOrEdit')) {
    initSortable(tableListRef.value)
  }
})

onBeforeUnmount(() => {
  if (sortable) sortable.destroy()
})
</script>

<template>
  <div class="flex flex-row items-center border-nc-border-gray-extralight transition-all duration-100 select-none min-w-0 w-full">
    <template v-if="!isMobileMode">
      <SmartsheetTopbarProjectListDropdown v-if="activeTable">
        <template #default="{ isOpen }">
          <div
            class="rounded-lg h-8 px-2 text-nc-content-inverted-secondary font-weight-500 hover:(bg-nc-bg-gray-light text-nc-content-gray-emphasis) flex items-center gap-1 cursor-pointer max-w-1/3"
            :class="{
              '!max-w-none': isSharedBase && !isMobileMode,
              '': !isMobileMode && isLeftSidebarOpen,
            }"
          >
            <NcTooltip :disabled="isSharedBase || isOpen">
              <template #title>
                <span class="capitalize">
                  {{ base?.title }}
                </span>
              </template>

              <GeneralProjectIcon
                :type="base?.type"
                :color="parseProp(base.meta).iconColor"
                :managed-app="{
                  managed_app_master: base?.managed_app_master,
                  managed_app_id: base?.managed_app_id,
                }"
                class="!grayscale min-w-4"
              />
            </NcTooltip>
            <template v-if="isSharedBase">
              <NcTooltip
                class="ml-1 truncate nc-active-base-title max-w-full !leading-5 !hidden lg:!block"
                show-on-truncate-only
                :disabled="isOpen"
              >
                <template #title>
                  <span class="capitalize">
                    {{ base?.title }}
                  </span>
                </template>

                <span
                  class="text-ellipsis capitalize"
                  :style="{
                    wordBreak: 'keep-all',
                    whiteSpace: 'nowrap',
                    display: 'inline',
                  }"
                >
                  {{ base?.title }}
                </span>
              </NcTooltip>
              <GeneralIcon
                icon="chevronDown"
                class="!text-current opacity-70 flex-none transform transition-transform duration-25 w-3.5 h-3.5 !hidden lg:!block"
                :class="{ '!rotate-180': isOpen }"
              />
            </template>
          </div>
        </template>
      </SmartsheetTopbarProjectListDropdown>

      <GeneralIcon icon="ncSlash1" class="nc-breadcrumb-divider" />

      <div ref="tableListRef" class="nc-table-tab-list">
        <div
          v-for="table in filteredTables"
          :key="table.id"
          :data-id="table.id"
          class="nc-table-tab-item"
          :class="{ 'nc-table-tab-active': table.id === activeTable?.id }"
          @click="handleNavigateToTable(table)"
        >
          <LazyGeneralEmojiPicker :emoji="table?.meta?.icon" readonly size="xsmall">
            <template #default>
              <GeneralTableIcon
                size="xsmall"
                :meta="{ meta: {}, synced: table?.synced }"
                class="!mx-0 min-w-4 !text-gray-500 flex-shrink-0"
              />
            </template>
          </LazyGeneralEmojiPicker>
          <NcTooltip class="truncate nc-table-tab-title" show-on-truncate-only>
            <template #title>{{ table?.title }}</template>
            {{ table?.title }}
          </NcTooltip>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped lang="scss">
.nc-table-tab-list {
  @apply flex items-center gap-0.5 overflow-x-auto min-w-0 flex-1 py-1;
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    display: none;
  }
}

.nc-table-tab-item {
  @apply flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer select-none whitespace-nowrap
    text-sm text-nc-content-gray-subtle2 hover:bg-nc-bg-gray-light hover:text-nc-content-gray-emphasis
    transition-colors duration-150 flex-shrink-0;
}

.nc-table-tab-active {
  @apply bg-nc-bg-gray-light text-nc-content-gray-emphasis font-semibold;
}

.nc-table-tab-ghost {
  @apply opacity-50;
}

.nc-table-tab-title {
  @apply max-w-32;
}
</style>
