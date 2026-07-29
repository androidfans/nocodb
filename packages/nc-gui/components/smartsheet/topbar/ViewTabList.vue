<script lang="ts" setup>
import type { ViewType } from 'nocodb-sdk'
import { ViewLockType, ViewTypes, getFirstNonPersonalView } from 'nocodb-sdk'
import type { SortableEvent } from 'sortablejs'
import Sortable from 'sortablejs'

const { $e } = useNuxtApp()

const { t } = useI18n()

const { isUIAllowed } = useRoles()

const { user } = useGlobal()

const { base } = storeToRefs(useBase())

const { basesUser } = storeToRefs(useBases())

const { activeTable } = storeToRefs(useTablesStore())

const viewsStore = useViewsStore()

const { activeView, views, viewsByTable } = storeToRefs(viewsStore)

const { navigateToView, updateView } = viewsStore

const { isMobileMode } = storeToRefs(useConfigStore())

const scrollContainerRef = ref<HTMLElement>()
const viewListRef = ref<HTMLElement>()

let sortable: Sortable

const idUserMap = computed(() => {
  return (basesUser.value.get(base.value?.id) || []).reduce((acc, u) => {
    acc[u.id] = u
    acc[u.email] = u
    return acc
  }, {} as Record<string, any>)
})

const getViewModeInfo = (view: ViewType) => {
  const isOwner = view?.owned_by === user.value?.id
  switch (view?.lock_type) {
    case ViewLockType.Personal:
      return `${t(viewLockIcons[ViewLockType.Personal]?.title)} ${
        isOwner
          ? `(${t('general.you')})`
          : view?.owned_by && idUserMap.value[view.owned_by]
          ? `(${idUserMap.value[view.owned_by]?.display_name || idUserMap.value[view.owned_by]?.email})`
          : ''
      }`
    case ViewLockType.Locked:
      return t(viewLockIcons[ViewLockType.Locked]?.title)
    default:
      return t(viewLockIcons[ViewLockType.Collaborative]?.title)
  }
}

const getViewCreatedBy = (view: ViewType) => {
  if (!view?.created_by || !idUserMap.value[view.created_by]) return ''
  const creator = idUserMap.value[view.created_by]
  return creator?.id === user.value?.id ? t('general.you') : creator?.display_name || creator?.email
}

const handleNavigateToView = async (view: ViewType) => {
  if (!view?.id || view.id === activeView.value?.id) return

  await navigateToView({
    view,
    tableId: activeTable.value.id!,
    tableTitle: activeTable.value?.title,
    baseId: base.value.id!,
    hardReload: view.type === ViewTypes.FORM && activeView.value?.id === view.id,
    doNotSwitchTab: true,
  })
}

function computeNewOrder(evt: SortableEvent, newIndex: number): number | null {
  const children: HTMLCollection = evt.to.children

  if (children.length <= 1) return 1

  const itemBeforeEl = children[newIndex - 1] as HTMLElement | undefined
  const itemAfterEl = children[newIndex + 1] as HTMLElement | undefined

  const itemBefore = itemBeforeEl && views.value.find((v) => v.id === itemBeforeEl.dataset.id)
  const itemAfter = itemAfterEl && views.value.find((v) => v.id === itemAfterEl.dataset.id)

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
    ghostClass: 'nc-view-tab-ghost',
    animation: 150,
    revertOnSpill: true,
    onEnd: async (evt) => {
      const { newIndex = 0, oldIndex = 0 } = evt
      if (newIndex === oldIndex) return

      const itemEl = evt.item as HTMLElement
      const currentItem = views.value.find((v) => v.id === itemEl.dataset.id)
      if (!currentItem || !currentItem.id) return

      const firstCollaborativeView = getFirstNonPersonalView(views.value, {
        includeViewType: ViewTypes.GRID,
      })
      const isFirstCollaborativeView = firstCollaborativeView?.id === currentItem.id

      const newOrder = computeNewOrder(evt, newIndex)
      if (newOrder == null) return

      currentItem.order = newOrder

      if (activeTable.value?.base_id && activeTable.value?.id) {
        const key = `${activeTable.value.base_id}:${activeTable.value.id}`
        const tableViews = viewsByTable.value.get(key)
        if (tableViews) {
          tableViews.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

          const defaultViewAfterUpdate = getFirstNonPersonalView(tableViews, {
            includeViewType: ViewTypes.GRID,
          })

          await updateView(
            currentItem.id,
            { order: currentItem.order },
            { is_default_view: isFirstCollaborativeView || defaultViewAfterUpdate?.id !== firstCollaborativeView?.id },
          )
          $e('a:view:reorder')
        }
      }
    },
    ...getDraggableAutoScrollOptions({ scrollSensitivity: 50 }),
  })
}

watchEffect(() => {
  if (viewListRef.value && isUIAllowed('viewCreateOrEdit')) {
    initSortable(viewListRef.value)
  }
})

onBeforeUnmount(() => {
  if (sortable) sortable.destroy()
})
</script>

<template>
  <div ref="scrollContainerRef" class="nc-view-tab-scroll-container">
    <div ref="viewListRef" class="nc-view-tab-list">
      <div
        v-for="view in views"
        :key="view.id"
        :data-id="view.id"
        class="nc-view-tab-item"
        :class="{ 'nc-view-tab-active': view.id === activeView?.id }"
        @click="handleNavigateToView(view)"
      >
        <LazyGeneralEmojiPicker :emoji="view?.meta?.icon" readonly size="xsmall">
          <template #default>
            <GeneralViewIcon :meta="{ type: view?.type }" class="nc-view-tab-icon" />
          </template>
        </LazyGeneralEmojiPicker>
        <NcTooltip
          :tooltip-style="{ width: '220px' }"
          :overlay-inner-style="{ width: '220px' }"
          trigger="hover"
          placement="bottom"
          :mouse-enter-delay="0.5"
        >
          <template #title>
            <div class="flex flex-col gap-2">
              <div>
                <div class="text-[10px] leading-[14px] uppercase mb-0.5 opacity-70">{{ $t('labels.viewName') }}</div>
                <div class="text-small leading-[18px]">{{ view?.title }}</div>
              </div>
              <div v-if="getViewCreatedBy(view)">
                <div class="text-[10px] leading-[14px] uppercase mb-0.5 opacity-70">{{ $t('labels.createdBy') }}</div>
                <div class="text-xs">{{ getViewCreatedBy(view) }}</div>
              </div>
              <div>
                <div class="text-[10px] leading-[14px] uppercase mb-0.5 opacity-70">{{ $t('labels.viewMode') }}</div>
                <div class="text-xs">{{ getViewModeInfo(view) }}</div>
              </div>
            </div>
          </template>
          <div class="truncate nc-view-tab-title">{{ view?.title }}</div>
        </NcTooltip>
        <component
          :is="viewLockIcons[view.lock_type]?.icon"
          v-if="view.lock_type && [ViewLockType.Locked, ViewLockType.Personal].includes(view.lock_type)"
          class="flex-none w-3 h-3 opacity-60"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.nc-view-tab-scroll-container {
  @apply flex items-center flex-1 min-w-0 overflow-hidden;
}

.nc-view-tab-list {
  @apply flex items-center gap-0.5 overflow-x-auto min-w-0 w-max max-w-full py-1;
  overscroll-behavior-x: contain;
  scrollbar-width: none;
  -ms-overflow-style: none;
  &::-webkit-scrollbar {
    display: none;
  }
}

.nc-view-tab-item {
  @apply flex items-center gap-1.5 px-2 py-1 rounded-md cursor-pointer select-none whitespace-nowrap
    text-sm text-nc-content-gray-subtle2 hover:bg-nc-bg-gray-light hover:text-nc-content-gray-emphasis
    transition-colors duration-150 flex-shrink-0;
}

.nc-view-tab-active {
  @apply bg-nc-bg-gray-light text-nc-content-gray-emphasis font-semibold;
}

.nc-view-tab-ghost {
  @apply opacity-50;
}

.nc-view-tab-icon {
  @apply min-w-4 text-base flex flex-shrink-0;
}

.nc-view-tab-title {
  @apply max-w-32;
}
</style>
