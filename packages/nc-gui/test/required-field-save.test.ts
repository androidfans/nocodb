import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type ColumnType, UITypes } from 'nocodb-sdk'
import * as vue from 'vue'
import { useProvideColumnCreateStore } from '../composables/useColumnCreateStore'

// Exercise the actual save implementation without a mounted editor or a live API/database.
vi.hoisted(() => {
  vi.stubGlobal('Form', { useForm: () => ({ validate: async () => true, validateInfos: {} }) })
  vi.stubGlobal('createInjectionState', (factory: unknown) => [factory, () => undefined])
})

vi.mock('../helpers/parsers/parserHelpers', () => ({ generateUniqueColumnName: () => 'Text' }))

const postOperation = vi.fn()
const messageError = vi.fn()
let scopes: vue.EffectScope[] = []

function createStore(existing?: ColumnType) {
  const scope = vue.effectScope()
  scopes.push(scope)
  return scope.run(() =>
    useProvideColumnCreateStore(
      vue.ref({ id: 'table', fk_workspace_id: 'workspace', base_id: 'base', source_id: 'source', table_name: 'example' }),
      vue.ref(existing),
    ),
  )!
}

beforeEach(() => {
  vi.clearAllMocks()
  postOperation.mockResolvedValue({ columns: [] })
  for (const [key, value] of Object.entries({
    ...vue,
    storeToRefs: (store: unknown) => store,
    useBase: () => ({
      isMysql: () => false,
      isPg: () => true,
      isXcdbBase: () => true,
      sqlUis: vue.ref({ source: {} }),
    }),
    useNuxtApp: () => ({ $api: { internal: { postOperation } }, $e: vi.fn() }),
    useMetas: () => ({ getMeta: vi.fn() }),
    useRoles: () => ({ isMetaReadOnly: vue.ref(false) }),
    useI18n: () => ({ t: (key: string) => key }),
    useViewsStore: () => ({ activeView: vue.ref({ id: 'view' }) }),
    useSmartsheetStoreOrThrow: () => ({ view: vue.ref({}), eventBus: { emit: vi.fn() } }),
    useViewData: () => ({}),
    usePredictFields: () => ({}),
    columnToValidate: [],
    SmartsheetStoreEvents: { FIELD_UPDATE: 'field-update', ROW_COLOR_UPDATE: 'row-color-update' },
    message: { error: messageError },
    extractSdkResponseErrorMsg: (error: Error) => error.message,
  }))
    vi.stubGlobal(key, value)
})

afterEach(() => {
  scopes.forEach((scope) => scope.stop())
  scopes = []
  vi.unstubAllGlobals()
})

describe('Required uses the existing field save pipeline', () => {
  it.each([true, false])('sends rqd=%s when adding a field', async (rqd) => {
    const store = createStore()
    store.formState.value = { title: 'Text', column_name: 'Text', uidt: UITypes.SingleLineText, rqd, unique: false, cdf: 'X' }
    store.onAlter()
    expect(await store.addOrUpdate(vi.fn())).toBe(true)
    expect(postOperation).toHaveBeenCalledWith(
      'workspace',
      'base',
      { operation: 'columnAdd', tableId: 'table' },
      expect.objectContaining({ rqd, altered: 2, unique: false, cdf: 'X' }),
    )
    expect(messageError).not.toHaveBeenCalled()
  })

  it.each([true, false])('sends rqd=%s when updating an existing field', async (rqd) => {
    const store = createStore({ id: 'column', title: 'Text', uidt: UITypes.SingleLineText, rqd: !rqd, unique: true })
    store.formState.value.rqd = rqd
    store.onAlter()
    expect(await store.addOrUpdate(vi.fn())).toBe(true)
    expect(postOperation).toHaveBeenCalledWith(
      'workspace',
      'base',
      { operation: 'columnUpdate', columnId: 'column' },
      expect.objectContaining({ rqd, altered: 2, unique: true }),
    )
    expect(messageError).not.toHaveBeenCalled()
  })

  it('surfaces a rejected NOT NULL change without calling the save-success callback', async () => {
    postOperation.mockRejectedValueOnce(new Error('Column contains null values'))
    const store = createStore({ id: 'column', title: 'Text', uidt: UITypes.SingleLineText, rqd: false })
    store.formState.value.rqd = true
    const onSuccess = vi.fn()
    await store.addOrUpdate(onSuccess)
    expect(messageError).toHaveBeenCalledWith('Column contains null values')
    expect(onSuccess).not.toHaveBeenCalled()
    expect(store.column.value?.rqd).toBe(false)
    expect(store.isSaving.value).toBe(false)
  })
})
