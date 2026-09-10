import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import * as vue from 'vue'
import { useVModel } from '@vueuse/core'
import TextArea from '../components/cell/TextArea.vue'
import Lookup from '../components/virtual-cell/Lookup.vue'
import { isSingleBtLongTextLookup } from '../utils/lookupUtils'

vi.mock('../helpers/tiptap', () => ({ NcMarkdownParser: { parse: vi.fn(() => '') } }))

const lookupColumn = {
  id: 'lookup',
  fk_model_id: 'source',
  colOptions: { fk_relation_column_id: 'relation', fk_lookup_column_id: 'text' },
}
const relation = { id: 'relation', uidt: 'Links', colOptions: { version: 2, type: 'mo', fk_related_model_id: 'target' } }
const longText = { id: 'text', title: 'Text', uidt: 'LongText' }
const keys = [
  'MetaInj',
  'ColumnInj',
  'EditModeInj',
  'EditColumnInj',
  'RowHeightInj',
  'IsFormInj',
  'FormFieldAutocompleteInj',
  'IsGridInj',
  'IsGalleryInj',
  'IsKanbanInj',
  'ReadonlyInj',
  'IsUnderFormulaInj',
  'CellEventHookInj',
  'ActiveCellInj',
  'ExtensionConfigInj',
  'CanvasCellEventDataInj',
  'IsCanvasInjectionInj',
  'ClientMousePositionInj',
  'IsUnderLookupInj',
  'IsUnderLTARInj',
  'CanvasSelectCellInj',
  'IsExpandedFormOpenInj',
  'RowInj',
  'CellValueInj',
  'IsGroupByLabelInj',
  'CellClickHookInj',
  'OnDivDataCellEventHookInj',
  'CellUrlDisableOverlayInj',
]
let wrappers: ReturnType<typeof shallowMount>[] = []
const selectCell = vi.fn()

function mountOptions(extraProvide = {}) {
  return {
    global: {
      provide: {
        ColumnInj: vue.ref(longText),
        MetaInj: vue.ref({ base_id: 'base' }),
        RowInj: vue.ref({ row: {} }),
        IsGridInj: vue.ref(true),
        IsCanvasInjectionInj: true,
        IsUnderLookupInj: vue.ref(true),
        ReadonlyInj: vue.ref(true),
        ActiveCellInj: vue.ref(true),
        RowHeightInj: vue.ref(2),
        CanvasSelectCellInj: { trigger: selectCell },
        ...extraProvide,
      },
      mocks: {
        $t: (key: string) => key,
        isAttachment: (c: any) => c?.uidt === 'Attachment',
        rowHeightTruncateLines: () => 1,
        ncIsObject: (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v),
        iconMap: { maximize: 'span' },
      },
      stubs: {
        AModal: { name: 'AModal', props: ['visible'], template: '<div class="viewer" />' },
        NcDropdown: { template: '<div><slot /></div>' },
        LazySmartsheetCell: { name: 'LazySmartsheetCell', props: ['autoExpand', 'readOnly', 'modelValue'], template: '<div />' },
      },
      config: { warnHandler: () => {} },
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const key of keys) vi.stubGlobal(key, key)
  for (const [key, value] of Object.entries({
    ...vue,
    useVModel,
    useGlobal: () => ({ showNull: vue.ref(false), user: vue.ref(null), isMobileMode: vue.ref(false) }),
    useSmartsheetRowStoreOrThrow: () => ({ currentRow: vue.ref({ row: {}, rowMeta: {} }) }),
    useNocoAi: () => ({
      aiLoading: vue.ref(false),
      aiIntegrations: vue.ref([]),
      generatingRows: vue.ref([]),
      generatingColumnRows: vue.ref([]),
    }),
    useBase: () => ({ idUserMap: vue.ref(new Map()) }),
    useBases: () => ({ basesUser: vue.ref(new Map()) }),
    storeToRefs: (store: unknown) => store,
    useElementSize: () => ({ height: vue.ref(0) }),
    useResizeObserver: vi.fn(),
    onClickOutside: vi.fn(),
    computedAsync: () => vue.ref(''),
    rowHeightTruncateLines: () => 1,
    rowHeightInPx: { 1: 32, 2: 60 },
    clientMousePositionDefaultValue: {},
    iconMap: { maximize: 'span' },
    isActiveInputElementExist: () => false,
    isExpandCellKey: (e: KeyboardEvent) => e.key === ' ' && e.shiftKey,
    isAttachment: (c: any) => c?.uidt === 'Attachment',
    ncIsObject: (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v),
    ncIsString: (v: unknown) => typeof v === 'string',
    ncIsArray: Array.isArray,
    useMetas: () => ({
      getMeta: vi.fn(),
      getMetaByKey: (_base: string, id: string) => ({ columns: id === 'source' ? [relation] : [longText] }),
    }),
    useShowNotEditableWarning: () => ({
      showEditNonEditableFieldWarning: vue.ref(false),
      showClearNonEditableFieldWarning: vue.ref(false),
      activateShowEditNonEditableFieldWarning: vi.fn(),
    }),
    useSelectedCellKeydownListener: vi.fn(),
    useAttachment: () => ({ getPossibleAttachmentSrc: () => [] }),
  }))
    vi.stubGlobal(key, value)
})

afterEach(() => {
  for (const wrapper of wrappers) wrapper.unmount()
  wrappers = []
  vi.unstubAllGlobals()
})

describe('direct BT Long Text eligibility', () => {
  it.each(['bt', 'mo'])('accepts direct %s single text', (type) => {
    expect(
      isSingleBtLongTextLookup({ ...relation, colOptions: { ...relation.colOptions, type } } as any, longText as any, ['Text']),
    ).toBe(true)
  })
  it.each(['hm', 'mm', 'om', 'oo'])('keeps %s lookup on the normal path even with one result', (type) => {
    expect(
      isSingleBtLongTextLookup({ ...relation, colOptions: { ...relation.colOptions, type } } as any, longText as any, ['Text']),
    ).toBe(false)
  })
  it.each([[], [''], [null], [['nested']], ['A', 'B']])(
    'does not auto-open empty, nested or multiple results: %j',
    (...values) => {
      expect(isSingleBtLongTextLookup(relation as any, longText as any, values)).toBe(false)
    },
  )
})

describe('Canvas Lookup handoff', () => {
  it.each([{}, { IsExpandedFormOpenInj: vue.ref(true) }, { IsCanvasInjectionInj: false }, { IsUnderLookupInj: vue.ref(true) }])(
    'limits auto-open to the active top-level Canvas cell: %j',
    (overrides) => {
      const wrapper = shallowMount(
        Lookup,
        mountOptions({
          ColumnInj: vue.ref(lookupColumn),
          CellValueInj: vue.ref('Text'),
          IsUnderLookupInj: vue.ref(false),
          ...overrides,
        }),
      )
      wrappers.push(wrapper)
      const child = wrapper.findComponent({ name: 'LazySmartsheetCell' })
      expect(child.props('autoExpand')).toBe(Object.keys(overrides).length === 0)
      expect(child.props('readOnly')).toBe(true)
    },
  )
})

describe('existing Long Text viewer auto-open', () => {
  it('opens on the first handoff without a second click or key event', async () => {
    const wrapper = shallowMount(TextArea, { ...mountOptions(), props: { modelValue: 'Text', virtual: true, autoExpand: true } })
    wrappers.push(wrapper)
    expect(wrapper.findComponent({ name: 'AModal' }).exists()).toBe(true)
    wrapper.findComponent({ name: 'AModal' }).vm.$emit('update:visible', false)
    await vue.nextTick()
    expect(wrapper.findComponent({ name: 'AModal' }).exists()).toBe(false)
    expect(selectCell).toHaveBeenCalledOnce()
  })
  it('waits for an explicit request and also handles delayed metadata/value', async () => {
    const wrapper = shallowMount(TextArea, { ...mountOptions(), props: { modelValue: 'Text', virtual: true, autoExpand: false } })
    wrappers.push(wrapper)
    expect(wrapper.findComponent({ name: 'AModal' }).exists()).toBe(false)
    await wrapper.setProps({ autoExpand: true })
    expect(wrapper.findComponent({ name: 'AModal' }).exists()).toBe(true)
  })
})
