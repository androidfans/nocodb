<script lang="ts" setup>
const route = useRoute()
const TAB_SPLIT_PERCENT_DEFAULT = 40
const TAB_SPLIT_SECTION_MIN_WIDTH_PX = 160
const TAB_SPLIT_HANDLE_WIDTH_PX = 16
const TAB_SPLIT_STORAGE_KEY = 'nc:smartsheet:topbar:tab-split:v1'

const { isUIAllowed } = useRoles()

const { isViewsLoading, openedViewsTab } = storeToRefs(useViewsStore())

const { activeScriptId } = storeToRefs(useScriptStore())

const { activeDashboardId, isEditingDashboard } = storeToRefs(useDashboardStore())

const { activeWorkflowId, activeWorkflowHasDraftChanges } = storeToRefs(useWorkflowStore())
const { activeTable } = storeToRefs(useTablesStore())

const isPublic = inject(IsPublicInj, ref(false))

const { isMobileMode } = storeToRefs(useConfigStore())

const { appInfo } = useGlobal()

const { toggleExtensionPanel, isPanelExpanded } = useExtensions()

const { toggleActionPanel, isPanelExpanded: isActionPanelExpanded, isViewActionsEnabled } = useActionPane()

const { isPanelExpanded: isChatPanelExpanded } = useChatPanel()

const { isFeatureEnabled } = useBetaFeatureToggle()

const { isEEFeatureBlocked, blockExtensions, showUpgradeToUseExtensions } = useEeConfig()

const isSharedBase = computed(() => route.params.typeOrId === 'base')

const showTabSections = computed(
  () => !isPublic.value && !activeScriptId.value && !activeDashboardId.value && !activeWorkflowId.value && !isMobileMode.value,
)

const tabSplitWidthPx = ref<number>()
const isDraggingSplit = ref(false)
const tabSplitAreaRef = ref<HTMLElement>()
const isTabSplitInitialized = ref(false)

const { width: tabSplitAreaWidth } = useElementSize(tabSplitAreaRef)

const normalizeTabSplitWidthPx = (value: unknown) => {
  const num = Number(value)
  if (!Number.isFinite(num)) return undefined
  return Math.max(TAB_SPLIT_SECTION_MIN_WIDTH_PX, num)
}

const clampTabSplitWidthPx = (value: number, areaWidth: number) => {
  if (!areaWidth) return Math.max(TAB_SPLIT_SECTION_MIN_WIDTH_PX, value)

  const maxWidth = Math.max(0, areaWidth - TAB_SPLIT_SECTION_MIN_WIDTH_PX - TAB_SPLIT_HANDLE_WIDTH_PX)
  const minWidth = Math.min(TAB_SPLIT_SECTION_MIN_WIDTH_PX, maxWidth)
  return Math.min(maxWidth, Math.max(minWidth, value))
}

const tabSplitStorageScope = computed(() => {
  const typeOrId = String(route.params.typeOrId ?? '')
  const baseId = String(route.params.baseId ?? '')
  const sourceId = String(activeTable.value?.source_id ?? '')
  return [typeOrId, baseId, sourceId].join(':')
})

const tabSectionStyle = computed(() => {
  if (!showTabSections.value) return undefined
  if (tabSplitWidthPx.value === undefined) return { width: `${TAB_SPLIT_PERCENT_DEFAULT}%` }

  // Clamp only the rendered width so a temporarily narrow viewport does not
  // overwrite the user's left-anchored position for wider screens.
  return { width: `${clampTabSplitWidthPx(tabSplitWidthPx.value, tabSplitAreaWidth.value)}px` }
})

const getTabSplitStorage = () => {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(TAB_SPLIT_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as Record<string, unknown>
  } catch {
    return {}
  }
}

const setTabSplitStorage = (next: Record<string, unknown>) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(TAB_SPLIT_STORAGE_KEY, JSON.stringify(next))
  } catch {
    // no-op: localStorage can fail in private mode / quota exceeded
  }
}

watch(
  tabSplitStorageScope,
  (scope) => {
    tabSplitWidthPx.value = normalizeTabSplitWidthPx(getTabSplitStorage()[scope])
    isTabSplitInitialized.value = true
  },
  { immediate: true },
)

const persistTabSplitWidth = () => {
  if (!isTabSplitInitialized.value || tabSplitWidthPx.value === undefined) return
  const next = getTabSplitStorage()
  next[tabSplitStorageScope.value] = tabSplitWidthPx.value
  setTabSplitStorage(next)
}

const onSplitDragStart = (e: MouseEvent) => {
  e.preventDefault()
  isDraggingSplit.value = true

  const onMove = (ev: MouseEvent) => {
    const splitAreaEl = tabSplitAreaRef.value
    if (!splitAreaEl) return
    const rect = splitAreaEl.getBoundingClientRect()
    tabSplitWidthPx.value = clampTabSplitWidthPx(ev.clientX - rect.left, rect.width)
  }

  const onUp = () => {
    isDraggingSplit.value = false
    persistTabSplitWidth()
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
  onMove(e)
}
</script>

<template>
  <div
    :class="{
      'bg-nc-bg-brand': isEditingDashboard || activeWorkflowHasDraftChanges,
    }"
    class="nc-table-topbar py-2 border-b-1 border-nc-border-gray-medium flex gap-3 items-center justify-between overflow-hidden relative h-[var(--topbar-height)] max-h-[var(--topbar-height)] min-h-[var(--topbar-height)] md:(px-2) xs:(px-1)"
    style="z-index: 7"
  >
    <template v-if="isViewsLoading && !activeScriptId && !activeDashboardId && !activeWorkflowId">
      <a-skeleton-input :active="true" class="!w-44 !h-4 ml-2 !rounded overflow-hidden" />
    </template>
    <template v-else>
      <div class="flex items-center gap-0 flex-1 min-w-0">
        <GeneralOpenLeftSidebarBtn />
        <div ref="tabSplitAreaRef" class="flex items-center min-w-0 flex-1">
          <!-- Table tabs section -->
          <div class="flex items-center gap-1 min-w-0 overflow-hidden flex-shrink-0" :style="tabSectionStyle">
            <LazySmartsheetToolbarViewInfo v-if="!isPublic && !activeScriptId && !activeDashboardId && !activeWorkflowId" />
            <LazySmartsheetTopbarScriptInfo v-if="!isPublic && activeScriptId" />
            <LazySmartsheetTopbarDashboardInfo v-if="!isPublic && activeDashboardId" />
            <LazySmartsheetTopbarWorkflowInfo v-if="!isPublic && activeWorkflowId" />
          </div>
          <!-- Draggable divider -->
          <div
            v-if="showTabSections"
            class="nc-tab-split-handle"
            :class="{ 'nc-tab-split-handle-active': isDraggingSplit }"
            @mousedown="onSplitDragStart"
          >
            <div class="nc-tab-split-line" />
          </div>
          <!-- View tabs section -->
          <SmartsheetTopbarViewTabList v-if="showTabSections" class="flex-1 min-w-0" />
        </div>
      </div>
      <div v-if="activeDashboardId || activeWorkflowId">
        <SmartsheetTopbarEditingState />
      </div>

      <div class="flex items-center justify-end gap-2">
        <!-- Variable Setup Warning -->
        <SmartsheetTopbarVariableSetupWarning v-if="!isSharedBase && !isMobileMode" />

        <!-- Managed App Status -->
        <LazySmartsheetTopbarManagedAppStatus v-if="!isSharedBase && !isMobileMode" />

        <!-- Sandbox Status -->
        <LazySmartsheetTopbarSandboxStatus v-if="!isSharedBase && !isMobileMode" />

        <LazySmartsheetTopbarCollaboratorPresence
          v-if="!isPublic && !isSharedBase && !isMobileMode && openedViewsTab === 'view' && appInfo.ee"
        />

        <LazySmartsheetTopbarHistory v-if="!isSharedBase && !isMobileMode && isEeUI" />

        <NcTooltip
          v-if="
            (isEeUI || isFeatureEnabled(FEATURE_FLAG.EXTENSIONS)) &&
            !isSharedBase &&
            !activeScriptId &&
            !activeDashboardId &&
            !activeWorkflowId &&
            openedViewsTab === 'view' &&
            !isMobileMode
          "
          placement="bottom"
        >
          <template #title>{{ $t('general.extensions') }}</template>
          <NcButton
            v-e="['c:extension-toggle']"
            type="text"
            size="small"
            class="nc-topbar-extension-btn"
            :class="{ '!bg-nc-bg-brand !text-nc-content-brand': isPanelExpanded }"
            data-testid="nc-topbar-extension-btn"
            @click="blockExtensions && !isPanelExpanded ? showUpgradeToUseExtensions() : toggleExtensionPanel()"
          >
            <GeneralIcon :icon="isPanelExpanded ? 'ncPuzzleSolid' : 'ncPuzzleOutline'" class="w-4 h-4 !stroke-transparent" />
          </NcButton>
        </NcTooltip>

        <NcButton
          v-if="
            !isSharedBase &&
            !activeScriptId &&
            !activeDashboardId &&
            !activeWorkflowId &&
            openedViewsTab === 'view' &&
            !isMobileMode &&
            isViewActionsEnabled &&
            !isEEFeatureBlocked
          "
          v-e="['c:action-toggle']"
          type="secondary"
          size="small"
          class="nc-topbar-action-btn"
          :class="{ '!bg-nc-bg-brand !hover:bg-nc-brand-100/70 !text-nc-content-brand': isActionPanelExpanded }"
          data-testid="nc-topbar-action-btn"
          @click="toggleActionPanel"
        >
          <div class="flex items-center justify-center min-w-[28.69px]">
            <GeneralIcon
              :icon="isActionPanelExpanded ? 'play' : 'play'"
              class="w-4 h-4 !stroke-transparent"
              :class="{ 'border-l-1 border-transparent': isActionPanelExpanded }"
            />
            <span
              class="overflow-hidden transition-all duration-200"
              :class="{
                'w-[0px] invisible': isActionPanelExpanded || isChatPanelExpanded,
                'ml-1 w-[54px]': !isActionPanelExpanded && !isChatPanelExpanded,
              }"
            >
              {{ $t('general.actions') }}
            </span>
          </div>
        </NcButton>

        <div v-if="!isSharedBase" class="flex gap-2 items-center empty:hidden">
          <LazySmartsheetTopbarDashboardState v-if="activeDashboardId && isUIAllowed('dashboardEdit')" />
          <LazySmartsheetTopbarScriptAction v-if="activeScriptId && appInfo.ee" />
          <LazySmartsheetTopbarWorkflowAction v-if="activeWorkflowId && appInfo.ee" />
        </div>

        <DashboardMiniSidebarTheme v-if="isSharedBase" placement="bottom" render-as-btn button-class="h-8 w-8" />

        <SmartsheetTopbarSelectMode
          v-if="!isSharedBase && !isMobileMode && !activeScriptId && !activeDashboardId && !activeWorkflowId"
          class="mr-1"
        />

        <LazySmartsheetTopbarShareProject v-if="!activeScriptId && !activeWorkflowId" />

        <div v-if="isSharedBase">
          <LazyGeneralLanguage
            button
            class="cursor-pointer text-lg hover:(text-nc-content-gray-extreme bg-nc-bg-gray-medium) mr-0 p-1.5 rounded-md"
          />
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.nc-table-toolbar-mobile {
  @apply flex-wrap h-auto py-2;
}

.nc-tab-split-handle {
  @apply flex items-center justify-center w-3 flex-shrink-0 cursor-col-resize self-stretch mx-0.5;
}

.nc-tab-split-line {
  @apply w-px h-4 bg-nc-border-gray-medium rounded transition-colors duration-150;
}

.nc-tab-split-handle:hover .nc-tab-split-line,
.nc-tab-split-handle-active .nc-tab-split-line {
  @apply bg-nc-content-gray-subtle2 w-0.5;
}
</style>
