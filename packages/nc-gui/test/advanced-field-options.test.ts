import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { parse } from '@vue/compiler-sfc'
import { Checkbox } from 'ant-design-vue'
import * as vue from 'vue'
import { useVModel } from '@vueuse/core'
import { UITypes, isVirtualCol } from 'nocodb-sdk'
import AdvancedOptions from '../components/smartsheet/column/AdvancedOptions.vue'
import editorSource from '../components/smartsheet/column/EditOrAdd.vue?raw'

// Render the actual advanced-options subtree and its ancestor v-if guards, without
// initializing the unrelated AI/integration/header-label parts of the field editor.
const { descriptor } = parse(editorSource)
function findAdvancedTemplate(node: any, guards: string[] = []): string | undefined {
  const condition = node.props?.find((p: any) => p.name === 'if')?.exp?.content
  if (node.tag === 'template' && condition?.includes('easterEgg')) {
    return `<template v-if="${guards.map((guard) => `(${guard})`).join(' && ')}">${node.loc.source}</template>`
  }
  for (const child of node.children || []) {
    const result = findAdvancedTemplate(child, condition ? [...guards, condition] : guards)
    if (result) return result
  }
}
const template = findAdvancedTemplate(descriptor.template!.ast)!

const onAlter = vi.fn()
const columnEditable = vi.fn(() => true)
let wrappers: ReturnType<typeof mount>[] = []

function mountEditor(overrides: Record<string, unknown> = {}) {
  const state = {
    appInfo: { ee: false },
    easterEgg: false,
    readOnly: false,
    isFullUpdateAllowed: true,
    warningVisible: false,
    props: { hideAdditionalOptions: false },
    advancedOptions: vue.ref(false),
    formState: vue.reactive({ uidt: UITypes.SingleLineText, dt: 'text', rqd: false }),
    meta: { source_id: 'source' },
    isXcdbBase: () => true,
    ...overrides,
  }
  const wrapper = mount(
    vue.defineComponent({
      setup: () => ({
        ...state,
        UITypes,
        isVirtualCol,
        isAttachment: (column: { uidt: string }) => column.uidt === UITypes.Attachment,
        MdiPlusIcon: 'span',
        MdiMinusIcon: 'span',
      }),
      template,
    }),
    {
      global: {
        components: { LazySmartsheetColumnAdvancedOptions: AdvancedOptions, ACheckbox: Checkbox },
        mocks: { $t: (key: string) => key, iconMap: { check: 'span' } },
        stubs: {
          AFormItem: { template: '<div><slot name="label" /><slot /></div>' },
          ASelect: true,
          ASelectOption: true,
          AInput: true,
          GeneralIcon: true,
          LazySmartsheetColumnPgBinaryOptions: true,
          LazySmartsheetColumnAttachmentOptions: true,
        },
      },
    },
  )
  wrappers.push(wrapper)
  return { wrapper, state }
}

beforeEach(() => {
  vi.clearAllMocks()
  columnEditable.mockReturnValue(true)
  for (const [key, value] of Object.entries({
    ...vue,
    useVModel,
    MetaInj: 'meta',
    useBase: () => ({ isPg: () => true }),
    useColumnCreateStoreOrThrow: () => ({
      onAlter,
      onDataTypeChange: vi.fn(),
      validateInfos: {},
      sqlUi: vue.ref({
        columnEditable,
        getDataTypeListForUiType: () => ['text'],
        colPropUNDisabled: () => true,
        colPropAuDisabled: () => true,
        getDefaultLengthIsDisabled: () => false,
        showScale: () => false,
      }),
    }),
  }))
    vi.stubGlobal(key, value)
})

afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers = []
  vi.unstubAllGlobals()
})

describe('upstream advanced field options in CE', () => {
  it('opens Show more without the easter egg, retaining the original NN/PK/AI/UN/AU controls', async () => {
    const { wrapper, state } = mountEditor()
    expect(wrapper.find('.nc-column-checkbox-NN').exists()).toBe(false)
    await wrapper.get('.nc-more-options').trigger('click')
    for (const name of ['NN', 'PK', 'AI', 'UN', 'AU']) {
      expect(wrapper.find(`.nc-column-checkbox-${name}`).exists()).toBe(true)
    }
    const checkbox = wrapper.get('.nc-column-checkbox-NN input')
    await checkbox.setValue(true)
    expect(state.formState.rqd).toBe(true)
    await checkbox.setValue(false)
    expect(state.formState.rqd).toBe(false)
    expect(onAlter).toHaveBeenCalledTimes(2)
    await wrapper.get('.nc-more-options').trigger('click')
    expect(wrapper.find('.nc-column-checkbox-NN').exists()).toBe(false)
  })

  it.each([
    { readOnly: true },
    { isFullUpdateAllowed: false },
    { props: { hideAdditionalOptions: true } },
    { formState: { uidt: UITypes.Lookup } },
    { formState: { uidt: UITypes.Formula } },
    { formState: { uidt: UITypes.Links } },
    { formState: { uidt: UITypes.Attachment } },
  ])('retains the original visibility guard: %j', (overrides) => {
    const { wrapper } = mountEditor(overrides)
    expect(wrapper.find('.nc-more-options').exists()).toBe(false)
  })

  it('keeps the EE external SpecificDBType easter-egg behavior', async () => {
    const easterEgg = vue.ref(false)
    const { wrapper } = mountEditor({
      appInfo: { ee: true },
      easterEgg,
      formState: { uidt: UITypes.SpecificDBType },
      isXcdbBase: () => false,
    })
    expect(wrapper.find('.nc-more-options').exists()).toBe(false)
    easterEgg.value = true
    await vue.nextTick()
    expect(wrapper.find('.nc-more-options').exists()).toBe(true)
  })

  it.each(['primary key', 'non-editable'])('retains the original NN lock for %s', async (kind) => {
    columnEditable.mockReturnValue(kind !== 'non-editable')
    const { wrapper } = mountEditor({
      formState: { uidt: UITypes.SingleLineText, dt: 'text', rqd: true, pk: kind === 'primary key' },
    })
    await wrapper.get('.nc-more-options').trigger('click')
    const input = wrapper.get<HTMLInputElement>('.nc-column-checkbox-NN input')
    expect(input.element.checked).toBe(true)
    expect(input.element.disabled).toBe(true)
    expect(onAlter).not.toHaveBeenCalled()
  })
})
