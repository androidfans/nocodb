import type { ColumnType, LinkToAnotherRecordType, TableType } from 'nocodb-sdk'
import { isBoxHovered } from '../../utils/canvas'
import { PlainCellRenderer } from '../Plain'
import { renderAsCellLookupOrLtarValue } from '../../utils/cell'

export const BelongsToCellRenderer: CellRenderer = {
  render: (ctx, props) => {
    const {
      value,
      x,
      y,
      width,
      height,
      spriteLoader,
      mousePosition,
      relatedTableMeta,
      renderCell,
      readonly,
      setCursor,
      selected,
      cellRenderStore,
      getColor,
      column,
    } = props

    const fkDisplayValueColumnId = (column?.colOptions as LinkToAnotherRecordType)?.fk_display_value_column_id

    const displayValueCol = fkDisplayValueColumnId
      ? relatedTableMeta?.columns?.find((c) => c.id === fkDisplayValueColumnId)
      : undefined

    const relatedTableDisplayValueProp =
      displayValueCol?.title || (relatedTableMeta?.columns?.find((c) => c.pv) || relatedTableMeta?.columns?.[0])?.title || ''

    const relatedTableDisplayValuePropId =
      displayValueCol?.id || (relatedTableMeta?.columns?.find((c) => c.pv) || relatedTableMeta?.columns?.[0])?.id || ''

    const btColumn = relatedTableMeta?.columns?.find((c: any) => c.title === relatedTableDisplayValueProp) as
      | ColumnType
      | undefined

    if (!btColumn) return
    let returnData

    if (isValidValue(value)) {
      // Match Vue layout: chips container = 100% - 16px (plus button),
      // inside chips: tag + x-circle(~14px) + gap(2px) = reserve 32px total when selected.
      const cellWidth = width - (!readonly && selected ? 32 : 0)

      const cellValue =
        value && !Array.isArray(value) && typeof value === 'object'
          ? value[relatedTableDisplayValueProp] ?? value[relatedTableDisplayValuePropId]
          : value

      const cellRenderer = (options: CellRendererOptions) => {
        return renderAsCellLookupOrLtarValue.includes(btColumn.uidt)
          ? renderCell(ctx, btColumn, options)
          : PlainCellRenderer.render(ctx, options)
      }

      returnData = cellRenderer({
        ...props,
        value: cellValue,
        column: btColumn,
        width: cellWidth,
        relatedColObj: undefined,
        relatedTableMeta: undefined,
        readonly: true,
        height: rowHeightInPx['1']!,
        padding: 7,
        textColor: getColor(themeV4Colors.brand['500']),
        tag: {
          renderAsTag: true,
          tagBgColor: getColor(themeV4Colors.brand['50'], 'var(--nc-bg-gray-light)'),
          tagHeight: 24,
          // 单独控制左右内边距，让胶囊视觉更贴近边界但不至于贴边到难读。
          tagPaddingX: 6,
        },
        meta: relatedTableMeta,
        x: x + 4,
        y: y + (rowHeightInPx['1'] === height ? 0 : 2),
      })

      if (!returnData?.x || !returnData?.y) return

      /**
       * x, y, width, height is required when user click on chip item to expand record
       */
      Object.assign(returnData, {
        width: returnData.x - x + 4,
        height: returnData.y - (y + (rowHeightInPx['1'] === height ? 0 : 2)),
      })

      Object.assign(cellRenderStore, returnData)

      // Show cursor pointer on hover over chip item
      if (
        !readonly &&
        selected &&
        isBoxHovered(
          {
            x: x + 4,
            y: y + (rowHeightInPx['1'] === height ? 0 : 2),
            height: cellRenderStore.height!,
            width: cellRenderStore.width!,
          },
          mousePosition,
        )
      ) {
        setCursor('pointer')
      }

      if (selected && !readonly) {
        // x-circle right after the tag, matching Vue's closeThick ml-0.5
        const xCircleX = returnData.x + 3
        const btnY = y + 10
        spriteLoader.renderIcon(ctx, {
          x: xCircleX,
          y: btnY,
          icon: 'ncXCircle',
          size: 15,
          color: isBoxHovered(
            { x: xCircleX, y: btnY, height: 15, width: 15 },
            mousePosition,
          )
            ? getColor(themeV4Colors.gray['500'])
            : getColor(themeV4Colors.gray['500'], undefined, 0.5),
        })

        if (
          isBoxHovered(
            { x: xCircleX, y: btnY, height: 15, width: 15 },
            mousePosition,
          )
        ) {
          setCursor('pointer')
        }
      }
    }

    if (selected && !readonly) {
      const btnY = y + 9
      spriteLoader.renderIcon(ctx, {
        x: x + width - 26,
        y: btnY,
        icon: 'ncPlus',
        size: 16,
        color: getColor(themeVariables.content['nc-content-gray'].subtle),
      })

      if (isBoxHovered({ x: x + width - 26, y: btnY, width: 16, height: 16 }, mousePosition)) {
        setCursor('pointer')
      }
    }

    return returnData
  },
  async handleClick({
    row,
    value,
    column,
    getCellPosition,
    mousePosition,
    makeCellEditable,
    cellRenderStore,
    selected,
    isPublic,
    readonly,
    isDoubleClick,
    openDetachedExpandedForm,
  }) {
    if (!selected && !isDoubleClick) return false

    const rowIndex = row.rowMeta.rowIndex!
    const { x, y, width, height } = getCellPosition(column, rowIndex)
    const size = 16

    /**
     * Note: The order of click action trigger is matter here to mimic behaviour of editable cell
     */

    /**
     * 1. When user clicks on Maximize/Plus icon make cell editable
     *    Open linked/unlinked record dropdown will handled in editable cell component
     *
     * 2. On click remove icon (cross) make cell editable
     *    Remove item on click cross in handled in editable cell component
     */
    const isClickedOnPlusIcon = isBoxHovered({ x: x + width - 26, y: y + 8, height: size, width: size }, mousePosition)

    const xCircleX = cellRenderStore?.x ? cellRenderStore.x + 2 : null
    const isClickedOnXCircleIcon =
      xCircleX != null &&
      selected &&
      isBoxHovered({ x: xCircleX, y: y + 7, height: size, width: size }, mousePosition)

    if (isClickedOnPlusIcon || isClickedOnXCircleIcon) {
      makeCellEditable(row, column)
      return true
    }

    /**
     * Expand record on click chip item if cell is selected and user has permission to edit data (e.g, not readonly)
     */
    if (
      (selected || isDoubleClick) &&
      ncIsObject(value) &&
      cellRenderStore?.height &&
      cellRenderStore?.width &&
      isBoxHovered(
        {
          x: x + 4,
          y: y + (rowHeightInPx['1'] === height ? 0 : 2),
          height: cellRenderStore.height,
          width: cellRenderStore.width,
        },
        mousePosition,
      )
    ) {
      /**
       * To mimic editable cell behaviour we added return statement here
       * If isPublic (stop event propagation on click chip item) `@click.stop="openExpandedForm"`
       */
      if (isPublic) return true

      const rowId = extractPkFromRow(value, (column.relatedTableMeta?.columns || []) as ColumnType[])

      if (rowId) {
        openDetachedExpandedForm({
          isOpen: true,
          row: { row: value, rowMeta: {}, oldRow: { ...value } },
          meta: column.relatedTableMeta || ({} as TableType),
          rowId,
          useMetaFields: true,
          maintainDefaultViewOrder: true,
          loadRow: !isPublic,
        })
      }

      /**
       * It's imp to add return here on click chip item to stop event propagation as while cell click action is also present below
       */
      return true
    }

    /**
     * This is same as `cellClickHook`, on click cell make cell editable
     */
    if ((selected || isDoubleClick) && !readonly && isBoxHovered({ x, y, width, height }, mousePosition)) {
      makeCellEditable(row, column)
      return true
    }

    return false
  },
}
