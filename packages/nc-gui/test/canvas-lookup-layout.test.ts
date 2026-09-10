import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LookupCellRenderer } from '../components/smartsheet/grid/canvas/cells/Lookup'
import { LongTextCellRenderer } from '../components/smartsheet/grid/canvas/cells/LongText'
import { SingleSelectCellRenderer } from '../components/smartsheet/grid/canvas/cells/SingleSelect'
import { renderTagLabel } from '../components/smartsheet/grid/canvas/utils/canvas'
import { layoutChipLines } from '../components/smartsheet/grid/canvas/utils/chipLayout'

const { context } = vi.hoisted(() => {
  vi.stubGlobal('OffscreenCanvas', class {})
  return {
    context: {
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      rect: vi.fn(),
      clip: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
      stroke: vi.fn(),
      fillText: vi.fn(),
      measureText: (text: string) => ({ width: text.length * 7 }),
      font: '500 13px Inter',
    },
  }
})

vi.mock('../components/smartsheet/grid/canvas/utils/safeCanvas', () => ({ getSafe2DContext: () => context }))
vi.mock('../components/smartsheet/grid/canvas/loaders/markdownLoader', () => ({ markdownTextCache: new Map() }))
vi.mock('../composables/useExpandedFormSiblingNavigation', () => ({}))
vi.mock('../components/smartsheet/grid/canvas/utils/cell', () => ({
  renderAsCellLookupOrLtarValue: ['LinkToAnotherRecord', 'Links', 'SingleSelect'],
  getRelatedBaseId: (_column: unknown, baseId: string) => baseId,
}))

const heights: Record<number, number> = { 32: 1, 60: 2, 90: 4, 120: 6 }
const lookup = {
  id: 'lookup',
  title: 'Lookup',
  uidt: 'Lookup',
  fk_model_id: 'source',
  colOptions: { fk_relation_column_id: 'relation', fk_lookup_column_id: 'target' },
}
const relation = {
  id: 'relation',
  title: 'Relation',
  uidt: 'LinkToAnotherRecord',
  colOptions: { version: 2, type: 'om', fk_related_model_id: 'intermediate' },
}
const target = {
  id: 'target',
  title: 'Target',
  uidt: 'LinkToAnotherRecord',
  colOptions: { version: 2, type: 'mo', fk_related_model_id: 'records' },
}
const recordsMeta = {
  id: 'records',
  base_id: 'base',
  columns: [
    { id: 'pk', title: 'Id', pk: true },
    { id: 'name', title: 'Name', uidt: 'SingleLineText', pv: true },
  ],
}
const records = [
  { Id: 1, Name: 'First record' },
  { Id: 2, Name: 'Second record' },
]

function makeProps(value: unknown, height = 60, width = 200) {
  const stores = new Map()
  return {
    value,
    height,
    width,
    x: 100,
    y: 100,
    column: lookup,
    pk: 10,
    padding: 10,
    meta: { id: 'source', base_id: 'base' },
    selected: true,
    row: {},
    metas: {
      'base:source': { columns: [relation, lookup] },
      'base:intermediate': { columns: [target] },
      'base:records': recordsMeta,
    },
    cellRenderStore: {} as any,
    getColor: (color: string) => color,
    mousePosition: { x: -1, y: -1 },
    setCursor: vi.fn(),
    tableMetaLoader: { isLoading: () => false, getTableMeta: vi.fn() },
    spriteLoader: { renderIcon: vi.fn() },
    // Like the canvas registry, nested calls resolve a store for their own
    // column ID; they do not inherit the outer Lookup's store.
    renderCell: (_ctx: unknown, column: any, props: any) => {
      if (!stores.has(column.id)) stores.set(column.id, {})
      if (column.uidt === 'LongText') {
        return LongTextCellRenderer.render(context as any, { ...props, cellRenderStore: stores.get(column.id) })
      }
      if (column.uidt === 'SingleSelect') {
        return SingleSelectCellRenderer.render(context as any, { ...props, cellRenderStore: stores.get(column.id) })
      }
      return renderTagLabel(context as any, { ...props, cellRenderStore: stores.get(column.id), text: String(props.value) })
    },
  } as any
}

async function click(props: any, point: { x: number; y: number }) {
  const open = vi.fn()
  await LookupCellRenderer.handleClick!({
    row: { rowMeta: { rowIndex: 0 } },
    column: {},
    selected: true,
    getCellPosition: () => ({ x: props.x, y: props.y, width: props.width, height: props.height }),
    mousePosition: point,
    cellRenderStore: props.cellRenderStore,
    openDetachedExpandedForm: open,
  } as any)
  return open
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const [key, value] of Object.entries({
    parseProp: (v: unknown) => v,
    ncIsArray: Array.isArray,
    ncIsObject: (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v),
    ncIsNullOrUndefined: (v: unknown) => v == null,
    ncIsNull: (v: unknown) => v === null,
    ncIsUndefined: (v: unknown) => v === undefined,
    isAttachment: (c: any) => c.uidt === 'Attachment',
    isRichText: (c: any) => !!c.meta?.richMode,
    rowHeightInPx: { 1: 32, 2: 60, 4: 90, 6: 120 },
    rowHeightTruncateLines: (h: number, chips: boolean) => (chips ? { 32: 1, 60: 2, 90: 3, 120: 4 }[h] ?? 1 : heights[h] ?? 1),
    themeV4Colors: {
      base: { white: '#fff' },
      brand: { 50: '#eef', 500: '#55f' },
      gray: { 200: '#ddd', 600: '#666', 700: '#555' },
    },
    parsePlainCellValue: (v: unknown) => String(v ?? ''),
    getOppositeColorOfBackground: () => '#000',
    extractPkFromRow: (v: any) => String(v.Id),
  }))
    vi.stubGlobal(key, value)
})

describe('Lookup record chips', () => {
  it.each([32, 60, 90, 120])('opens the second rendered chip at row height %s', async (height) => {
    const props = makeProps(records, height)
    LookupCellRenderer.render(context as any, props)
    const chips = props.cellRenderStore.ltar
    expect(chips).toHaveLength(2)
    expect(chips[1].value.Id).toBe(2)
    expect(chips[1].oldY > chips[0].oldY).toBe(height > 32)
    const open = await click(props, { x: chips[1].oldX + 2, y: chips[1].oldY + 2 })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ rowId: '2', meta: recordsMeta }))
  })

  it('does not open the first record from empty space', async () => {
    const props = makeProps(records, 120)
    LookupCellRenderer.render(context as any, props)
    expect(await click(props, { x: 280, y: 210 })).not.toHaveBeenCalled()
  })

  it('drops stale click targets when the value becomes empty', async () => {
    const props = makeProps(records)
    LookupCellRenderer.render(context as any, props)
    const second = props.cellRenderStore.ltar[1]
    props.value = null
    LookupCellRenderer.render(context as any, props)
    expect(await click(props, { x: second.oldX + 2, y: second.oldY + 2 })).not.toHaveBeenCalled()
  })

  it('flattens lookup-of-many records without changing their order or identity', () => {
    const props = makeProps([[records[0]], null, [records[1]]])
    LookupCellRenderer.render(context as any, props)
    expect(props.cellRenderStore.ltar.map((chip: any) => chip.value)).toEqual(records)
  })

  it('opens a scalar single-target lookup and honors its display-column override', async () => {
    const props = makeProps({ ...records[1], Alias: 'Other label' })
    props.metas['base:intermediate'] = {
      columns: [{ ...target, colOptions: { ...target.colOptions, fk_display_value_column_id: 'alias' } }],
    }
    props.metas['base:records'] = {
      ...recordsMeta,
      columns: [...recordsMeta.columns, { id: 'alias', title: 'Alias', uidt: 'SingleLineText' }],
    }
    LookupCellRenderer.render(context as any, props)
    expect(context.fillText.mock.calls.some(([text]) => text === 'Other label')).toBe(true)
    const chip = props.cellRenderStore.ltar[0]
    expect(await click(props, { x: chip.oldX + 2, y: chip.oldY + 2 })).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: '2' }),
    )
  })

  it('does not open hidden records from the ellipsis', async () => {
    const props = makeProps([...records, { Id: 3, Name: 'Third' }], 32, 180)
    LookupCellRenderer.render(context as any, props)
    expect(props.cellRenderStore.ltar).toHaveLength(2)
    expect(await click(props, { x: 277, y: 116 })).not.toHaveBeenCalled()
  })

  it.each([60, 90, 120])('places overflow in the final reserved row at height %s', async (height) => {
    const props = makeProps(
      Array.from({ length: 12 }, (_, i) => ({ Id: i + 1, Name: 'Long record label '.repeat(6) })),
      height,
      190,
    )
    LookupCellRenderer.render(context as any, props)
    // The final paint is the right-aligned overflow marker (the mock font may
    // itself truncate its dots); use its actual painted coordinates.
    const [, ellipsisX, ellipsisY] = context.fillText.mock.calls.at(-1)!
    expect(await click(props, { x: ellipsisX - 10, y: ellipsisY })).not.toHaveBeenCalled()
    const lastChip = props.cellRenderStore.ltar.at(-1)
    expect(ellipsisY).toBeGreaterThan(lastChip.oldY)
    expect(ellipsisY).toBeLessThan(lastChip.oldY + lastChip.height)
  })

  it('drops stale targets while linked-table metadata reloads', () => {
    const props = makeProps(records)
    LookupCellRenderer.render(context as any, props)
    delete props.metas['base:records']
    LookupCellRenderer.render(context as any, props)
    expect(props.cellRenderStore.ltar).toEqual([])
    expect(props.tableMetaLoader.getTableMeta).toHaveBeenCalledWith('records', 'base')
  })

  it.each([50, 60, 70])('fits the painted chip and text truncation inside a %spx column', (width) => {
    const props = makeProps([{ Id: 1, Name: 'A long linked record name' }], 32, width)
    LookupCellRenderer.render(context as any, props)
    const paintedTags = context.roundRect.mock.calls.filter(([x, y]) => x >= props.x && y >= props.y)
    expect(paintedTags).toHaveLength(1)
    for (const [x, , tagWidth] of paintedTags) expect(x + tagWidth).toBeLessThanOrEqual(props.x + width)
  })

  it.each([32, 60])('opens a lookup chip with a SingleSelect display field at height %s', async (height) => {
    const props = makeProps(records, height)
    props.metas['base:records'] = {
      ...recordsMeta,
      columns: recordsMeta.columns.map((c) => (c.pv ? { ...c, uidt: 'SingleSelect' } : c)),
    }
    LookupCellRenderer.render(context as any, props)
    const tag = context.roundRect.mock.calls.filter(([x, y]) => x >= props.x && y >= props.y).at(-1)!
    const [x, y, width, tagHeight] = tag
    expect(await click(props, { x: x + width / 2, y: y + tagHeight / 2 })).toHaveBeenCalledWith(
      expect.objectContaining({ rowId: '2' }),
    )
  })
})

describe('Long Text lookup tags', () => {
  it.each([32, 60, 90, 120])('uses the BT lookup row height %s for text lines', (height) => {
    const props = makeProps(['Long text '.repeat(60)], height, 160)
    props.metas['base:source'] = { columns: [{ ...relation, colOptions: { ...relation.colOptions, type: 'mo' } }, lookup] }
    props.metas['base:intermediate'] = { columns: [{ ...target, uidt: 'LongText' }] }
    LookupCellRenderer.render(context as any, props)
    expect(context.fillText.mock.calls).toHaveLength(heights[height])
    const [, y, , bubbleHeight] = context.roundRect.mock.calls.at(-1)!
    expect(bubbleHeight > 20).toBe(height > 32)
    expect(y + bubbleHeight).toBeLessThanOrEqual(props.y + height)
  })

  it('keeps a many-target Long Text lookup compact even with one result', () => {
    const props = makeProps(['Long text '.repeat(60)], 120)
    props.metas['base:intermediate'] = { columns: [{ ...target, uidt: 'LongText' }] }
    LookupCellRenderer.render(context as any, props)
    expect(context.fillText.mock.calls).toHaveLength(1)
  })

  it('preserves explicit newlines for a legacy BT lookup', () => {
    const props = makeProps('First line\nSecond line', 90)
    props.metas['base:source'] = {
      columns: [{ ...relation, colOptions: { ...relation.colOptions, version: 1, type: 'bt' } }, lookup],
    }
    props.metas['base:intermediate'] = { columns: [{ ...target, uidt: 'LongText' }] }
    LookupCellRenderer.render(context as any, props)
    expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(['First line', 'Second line'])
  })

  it.each([
    { value: 'One\nTwo\nThree', expected: ['One', 'Two...'] },
    { value: 'One\nTwo', expected: ['One', 'Two'] },
  ])('marks hidden newline segments without marking fully visible text: $value', ({ value, expected }) => {
    const props = makeProps(value, 60)
    props.metas['base:source'] = { columns: [{ ...relation, colOptions: { ...relation.colOptions, type: 'mo' } }, lookup] }
    props.metas['base:intermediate'] = { columns: [{ ...target, uidt: 'LongText' }] }
    LookupCellRenderer.render(context as any, props)
    expect(context.fillText.mock.calls.map(([text]) => text)).toEqual(expected)
  })

  it.each([60, 90, 120])('bounds rich-text wrapping at height %s', (height) => {
    const props = makeProps('Rich text '.repeat(60), height, 160)
    props.metas['base:source'] = { columns: [{ ...relation, colOptions: { ...relation.colOptions, type: 'mo' } }, lookup] }
    props.metas['base:intermediate'] = { columns: [{ ...target, uidt: 'LongText', meta: { richMode: true } }] }
    props.markdownLoader = {
      loadOrGetMarkdown: (_key: string, options: any) => ({
        width: options.maxWidth,
        blocks: [{ type: 'paragraph', tokens: [{ value: props.value, styles: [] }] }],
      }),
      isLoading: () => false,
    }
    LookupCellRenderer.render(context as any, props)
    expect(context.fillText.mock.calls).toHaveLength(heights[height])
    const [x, y, bubbleWidth, bubbleHeight] = context.roundRect.mock.calls.at(-1)!
    expect(x + bubbleWidth).toBeLessThanOrEqual(props.x + props.width)
    expect(y + bubbleHeight).toBeLessThanOrEqual(props.y + props.height)
  })
})

describe('shared balanced layout', () => {
  it('distributes six chips over three rows', () => {
    expect(layoutChipLines([72, 72, 72, 72, 72, 72], 300, 3).map((line) => line.widths.length)).toEqual([2, 2, 2])
  })
  it('shrinks long labels proportionally and reserves ellipsis capacity', () => {
    expect(layoutChipLines([100, 300], 200, 1)[0]!.widths).toEqual([72, 128])
    expect(layoutChipLines([100, 100, 100], 200, 1)[0]!.reserveEllipsisWidth).toBe(16)
  })
})
