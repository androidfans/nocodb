import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { parse } from '@vue/compiler-sfc'
import * as vue from 'vue'
import { useVModel } from '@vueuse/core'
import { UITypes } from 'nocodb-sdk'
import NcSwitch from '../components/nc/Switch.vue'
import editorSource from '../components/smartsheet/column/EditOrAdd.vue?raw'

const { descriptor } = parse(editorSource)

function findConstraintsRow(node: any): string | undefined {
  if (node.props?.some((prop: any) => prop.name === 'class' && prop.value?.content.includes('nc-column-constraints-row'))) {
    return node.loc.source
  }

  for (const child of node.children || []) {
    const result = findConstraintsRow(child)
    if (result) return result
  }
}

const constraintsTemplate = findConstraintsRow(descriptor.template!.ast)!
const onAlter = vi.fn()
const columnEditable = vi.fn(() => true)
let wrappers: ReturnType<typeof mount>[] = []

function mountConstraints(overrides: Record<string, unknown> = {}) {
  const state = {
    showUniqueOption: true,
    showNotNullOption: true,
    unique: vue.ref(false),
    formState: vue.reactive({ uidt: UITypes.SingleLineText, rqd: false, pk: false }),
    sqlUi: { columnEditable },
    meta: { source_id: 'source' },
    isXcdbBase: () => true,
    canEnableUniqueConstraint: () => ({ canEnable: true, reason: '' }),
    onMouseOverUniqueValuesInfoIcon: false,
    blockUnique: false,
    PlanFeatureTypes: {},
    PlanTitles: {},
    onNotNullChange: (checked: boolean) => {
      state.formState.rqd = checked
      onAlter()
    },
    ...overrides,
  }

  const wrapper = mount(vue.defineComponent({ setup: () => state, template: constraintsTemplate }), {
    global: {
      components: { NcSwitch },
      mocks: { $t: (key: string) => key },
      stubs: {
        ASwitch: {
          props: ['checked', 'disabled'],
          emits: ['change'],
          template:
            '<input type="checkbox" :checked="checked" :disabled="disabled" @change="$emit(\'change\', $event.target.checked)" />',
        },
        NcTooltip: { template: '<div><slot name="title" /><slot /></div>' },
        GeneralIcon: true,
        PaymentUpgradeBadge: true,
      },
    },
  })

  wrappers.push(wrapper)
  return { wrapper, state }
}

beforeEach(() => {
  vi.clearAllMocks()
  columnEditable.mockReturnValue(true)
  for (const [key, value] of Object.entries({ ...vue, useVModel })) {
    vi.stubGlobal(key, value)
  }
})

afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers = []
  vi.unstubAllGlobals()
})

describe('inline Not null option', () => {
  it('uses the same wrapping row and switch component as Unique values only', () => {
    const { wrapper } = mountConstraints()
    const row = wrapper.get('.nc-column-constraints-row')

    expect(row.classes()).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'items-center']))
    expect(row.findAll('input[type="checkbox"]')).toHaveLength(2)
    expect(row.get('.nc-column-not-null-option').text()).toBe('filterOperation.isNotNull')
  })

  it('updates rqd and marks the field altered', async () => {
    const { wrapper, state } = mountConstraints()
    const notNullSwitch = wrapper.get<HTMLInputElement>('[data-testid="nc-column-not-null"]')

    await notNullSwitch.setValue(true)
    expect(state.formState.rqd).toBe(true)
    await notNullSwitch.setValue(false)
    expect(state.formState.rqd).toBe(false)
    expect(onAlter.mock.calls).toEqual([[], []])
  })

  it('does not render when the field is ineligible', () => {
    const { wrapper } = mountConstraints({ showNotNullOption: false })
    expect(wrapper.find('[data-testid="nc-column-not-null"]').exists()).toBe(false)
  })

  it.each(['primary key', 'non-editable'])('disables the switch for a %s field', (kind) => {
    columnEditable.mockReturnValue(kind !== 'non-editable')
    const { wrapper } = mountConstraints({
      formState: vue.reactive({ uidt: UITypes.SingleLineText, rqd: true, pk: kind === 'primary key' }),
    })

    expect(wrapper.get<HTMLInputElement>('[data-testid="nc-column-not-null"]').element.disabled).toBe(true)
  })
})
