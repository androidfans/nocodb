import { describe, expect, it } from 'vitest'
import optionSource from '../components/smartsheet/column/LinkedToAnotherRecordOptions.vue?raw'
import {
  canConfigureRecordDeleteProtection,
  isRecordDeleteProtectionEnabled,
  withRecordDeleteProtection,
} from '../utils/recordDeleteProtection'

describe('record delete protection field option', () => {
  it('renders a compact switch with a tooltip in the shared create/edit component', () => {
    expect(optionSource).toContain('data-testid="nc-record-delete-protection"')
    expect(optionSource).toContain("$t('labels.recordDeleteProtection')")
    expect(optionSource).toContain("$t('tooltip.recordDeleteProtection')")
  })

  it('is available only for standard relations in an internal source', () => {
    expect(canConfigureRecordDeleteProtection({ meta: {} }, true)).toBe(true)
    expect(canConfigureRecordDeleteProtection({ meta: {} }, false)).toBe(false)
    expect(canConfigureRecordDeleteProtection({ is_custom_link: true, meta: {} }, true)).toBe(false)
    expect(canConfigureRecordDeleteProtection({ meta: { custom: true } }, true)).toBe(false)
  })

  it('defaults to disabled and persists the option in column meta', () => {
    const column = { meta: { existing: 'value' } }

    expect(isRecordDeleteProtectionEnabled(column)).toBe(false)
    column.meta = withRecordDeleteProtection(column, true)
    expect(column.meta).toEqual({ existing: 'value', recordDeleteProtection: true })
    expect(isRecordDeleteProtectionEnabled(column)).toBe(true)
  })

  it('preserves serialized meta returned by older cache paths', () => {
    const column = { meta: JSON.stringify({ existing: 'value' }) }

    expect(withRecordDeleteProtection(column, true)).toEqual({
      existing: 'value',
      recordDeleteProtection: true,
    })
  })
})
