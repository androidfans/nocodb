import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import * as vue from 'vue'
import { useVModel } from '@vueuse/core'
import { type ColumnType, UITypes } from 'nocodb-sdk'
import RequiredOptions from '../components/smartsheet/column/RequiredOptions.vue'
import NcSwitch from '../components/nc/Switch.vue'

const onAlter = vi.fn()
const columnEditable = vi.fn(() => true)
const isSystem = vue.ref(false)
const isSyncedField = vue.ref(false)
let wrappers: ReturnType<typeof mount>[] = []

function mountRequired(value: Partial<ColumnType> = {}) {
  const field = vue.reactive({ uidt: UITypes.SingleLineText, rqd: false, ...value })
  const wrapper = mount(RequiredOptions, {
    props: { value: field },
    global: {
      components: { NcSwitch },
      mocks: { $t: (key: string) => key },
      stubs: {
        NcTooltip: { template: '<div><slot /></div>' },
        ASwitch: {
          props: ['checked', 'disabled'],
          emits: ['change'],
          template:
            '<input type="checkbox" :checked="checked" :disabled="disabled" @change="$emit(\'change\', $event.target.checked)" />',
        },
      },
    },
  })
  wrappers.push(wrapper)
  return { wrapper, field }
}

beforeEach(() => {
  vi.clearAllMocks()
  columnEditable.mockReturnValue(true)
  isSystem.value = false
  isSyncedField.value = false
  for (const [key, value] of Object.entries({
    ...vue,
    useVModel,
    useColumnCreateStoreOrThrow: () => ({
      onAlter,
      sqlUi: vue.ref({ columnEditable }),
      isSystem,
      isSyncedField,
    }),
  }))
    vi.stubGlobal(key, value)
})

afterEach(() => {
  wrappers.forEach((wrapper) => wrapper.unmount())
  wrappers = []
  vi.unstubAllGlobals()
})

describe('Required field option', () => {
  it.each([UITypes.SingleLineText, UITypes.LongText, UITypes.Number, UITypes.DateTime, UITypes.SingleSelect])(
    'shows the ordinary %s field option without an EE or easter-egg flag',
    (uidt) => {
      const { wrapper } = mountRequired({ uidt })
      expect(wrapper.find('[data-testid="nc-column-required"]').exists()).toBe(true)
      expect(wrapper.text()).toContain('general.required')
    },
  )

  it.each([false, true, 0, 1, undefined])('reflects persisted rqd=%s without modifying metadata', (rqd) => {
    const { wrapper, field } = mountRequired({ rqd: rqd as boolean })
    expect(wrapper.get<HTMLInputElement>('input').element.checked).toBe(!!rqd)
    expect(field.rqd).toBe(rqd)
    expect(onAlter).not.toHaveBeenCalled()
  })

  it('toggles the existing rqd field in both directions, without changing Unique or the default', async () => {
    const { wrapper, field } = mountRequired({ unique: true, cdf: 'Default' })
    await wrapper.get('input').setValue(true)
    expect(field.rqd).toBe(true)
    await wrapper.get('input').setValue(false)
    expect(field.rqd).toBe(false)
    expect(field.unique).toBe(true)
    expect(field.cdf).toBe('Default')
    expect(onAlter.mock.calls).toEqual([[], []])
  })

  it('supports clicking the switch label', async () => {
    const { wrapper, field } = mountRequired()
    await wrapper.get('.pl-2').trigger('click')
    expect(field.rqd).toBe(true)
    expect(onAlter).toHaveBeenCalledOnce()
  })

  it('reflects a newly loaded field instead of keeping the previous required state', async () => {
    const { wrapper } = mountRequired({ rqd: true })
    await wrapper.setProps({ value: { uidt: UITypes.Number, rqd: false } })
    expect(wrapper.get<HTMLInputElement>('input').element.checked).toBe(false)
    expect(onAlter).not.toHaveBeenCalled()
  })

  it.each(['primary key', 'system', 'synced', 'non-editable'])('locks a %s field', async (kind) => {
    isSystem.value = kind === 'system'
    isSyncedField.value = kind === 'synced'
    columnEditable.mockReturnValue(kind !== 'non-editable')
    const { wrapper, field } = mountRequired({ rqd: true, pk: kind === 'primary key' })
    expect(wrapper.get<HTMLInputElement>('input').element.disabled).toBe(true)
    await wrapper.get('.pl-2').trigger('click')
    // Even an emitted change from a disabled control must not mutate metadata.
    wrapper.getComponent(NcSwitch).vm.$emit('change', false)
    expect(field.rqd).toBe(true)
    expect(onAlter).not.toHaveBeenCalled()
  })

  it.each([
    UITypes.Lookup,
    UITypes.Formula,
    UITypes.Rollup,
    UITypes.Links,
    UITypes.LinkToAnotherRecord,
    UITypes.CreatedTime,
    UITypes.LastModifiedBy,
    UITypes.Attachment,
    UITypes.UUID,
    UITypes.AutoNumber,
  ])('does not offer ordinary NOT NULL editing for %s', (uidt) => {
    const { wrapper } = mountRequired({ uidt })
    expect(wrapper.find('input').exists()).toBe(false)
    expect(onAlter).not.toHaveBeenCalled()
  })
})
