import type { ColumnType, LinkToAnotherRecordType, TableType } from 'nocodb-sdk'
import { defaultOffscreen2DContext, isBoxHovered, renderIconButton, renderSingleLineText } from '../../utils/canvas'
import { PlainCellRenderer } from '../Plain'
import { renderAsCellLookupOrLtarValue } from '../../utils/cell'

const ellipsisWidth = 15
const buttonSize = 20

export const HasManyCellRenderer: CellRenderer = {
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
      cellRenderStore,
      selected,
      getColor,
    } = props

    const fkDisplayValueColumnId = (props.column?.colOptions as LinkToAnotherRecordType)?.fk_display_value_column_id

    const relatedTableDisplayValueProp = fkDisplayValueColumnId
      ? relatedTableMeta?.columns?.find((c) => c.id === fkDisplayValueColumnId)?.title || ''
      : (relatedTableMeta?.columns?.find((c) => c.pv) || relatedTableMeta?.columns?.[0])?.title || ''

    const hmColumn = relatedTableMeta?.columns?.find((c: any) => c.title === relatedTableDisplayValueProp) as
      | ColumnType
      | undefined

    if (!hmColumn) return

    const cells = (ncIsArray(value) ? value : []).reduce((acc, curr) => {
      if (!relatedTableDisplayValueProp) return acc

      const value = curr[relatedTableDisplayValueProp]

      acc.push({ value, item: curr })

      return acc
    }, []) as { value: any; item: Record<string, any> }[]
    const initialX = x + 4
    const initialWidth = width - 8
    // 统一用固定右边界做布局，避免 currentWidth 连续扣减后累计误差，
    // 造成“chip 与 ... 的右侧空白始终偏大/不稳定”。
    const rightBoundary = initialX + initialWidth

    let currentX = initialX
    let currentY = y + (rowHeightInPx['1'] === height ? 0 : 2)
    let currentWidth = initialWidth
    // 渲染器返回的 point.x 偶发会略保守，给一个很小的补偿以减少视觉缝隙。
    const chipEndCompensation = 4

    // clip 保护：防止换行/极限宽度情况下 chip 或文字越界绘制到相邻单元格。
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, width, height)
    ctx.clip()

    /**
     * Chip info which is oldX, oldY, x, y, width, height, value is required when user click on chip item to expand record
     * Value added in returnData because we don't want to calculate it again
     */
    const returnData: CellRenderStore['ltar'] = []

    const renderProps: CellRendererOptions = {
      ...props,
      column: hmColumn,
      relatedColObj: undefined,
      relatedTableMeta: undefined,
      readonly: true,
      height: rowHeightInPx['1']!,
      // 这里使用更小的 padding，是为了让可用内容宽度尽可能大，减少过早省略。
      padding: 4,
      textColor: getColor(themeV4Colors.brand['500']),
      tag: {
        renderAsTag: true,
        tagBgColor: getColor(themeV4Colors.brand['50'], 'var(--nc-bg-gray-light)'),
        tagHeight: 24,
        // 左右内边距改为可控值，目标是贴边更自然，同时保证可读性。
        tagPaddingX: 6,
        tagPaddingRight: 10,
        tagSpacing: 2,
      },
      meta: relatedTableMeta,
    }

    const cellRenderer = (options: CellRendererOptions) => {
      return renderAsCellLookupOrLtarValue.includes(hmColumn.uidt)
        ? renderCell(ctx, hmColumn, options)
        : PlainCellRenderer.render(ctx, options)
    }
    const measureCellRenderer = (options: CellRendererOptions) => {
      // 先离屏测量，再决定是否需要换行，避免“先渲染再回退”导致闪烁和反复横跳。
      return renderAsCellLookupOrLtarValue.includes(hmColumn.uidt)
        ? renderCell(defaultOffscreen2DContext, hmColumn, options)
        : PlainCellRenderer.render(defaultOffscreen2DContext, options)
    }

    const maxLines = rowHeightTruncateLines(height, true)
    let line = 1
    let flag = false
    let count = 1
    // 保证最差情况下仍能至少看见一个字符，避免 chip 被压成纯色块。
    const minChipTextSafeWidth = 30

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!
      const hasRemainingCells = i < cells.length - 1
      const getLineLayout = () => {
        // 最后一行且后面还有数据时，预留 ... 宽度，防止 ... 与最后一个 chip 重叠。
        const reserveEllipsisWidth = line >= maxLines && hasRemainingCells ? ellipsisWidth + 1 : 0
        const chipRightBoundary = rightBoundary - reserveEllipsisWidth
        const availableWidth = Math.max(0, chipRightBoundary - currentX)
        return { chipRightBoundary, availableWidth }
      }
      let { chipRightBoundary, availableWidth } = getLineLayout()

      if (line >= maxLines && hasRemainingCells && availableWidth <= minChipTextSafeWidth) {
        flag = true
        break
      }

      if (currentX > initialX) {
        const measurePoint = measureCellRenderer({
          ...renderProps,
          value: cell.value,
          x: 0,
          y: 0,
          width: availableWidth,
        })
        const measuredWidth = Math.max(0, (measurePoint?.x ?? 0) - 0)

        if (measuredWidth > availableWidth) {
          if (line + 1 > maxLines) {
            flag = true
            break
          }

          currentX = initialX
          currentWidth = initialWidth
          currentY += 28
          line += 1
          ;({ chipRightBoundary, availableWidth } = getLineLayout())

          if (line >= maxLines && hasRemainingCells && availableWidth <= minChipTextSafeWidth) {
            flag = true
            break
          }
        }
      }

      const point = cellRenderer({
        ...renderProps,
        value: cell.value,
        x: currentX,
        y: currentY,
        width: availableWidth,
      })

      if (point?.x) {
        // 再次限制到 chipRightBoundary 内，确保不会把事件命中区和视觉渲染推到单元格外。
        const boundedPointX = Math.min(point.x + chipEndCompensation, chipRightBoundary)
        // Add rendered chip info in return data
        returnData.push({
          oldX: currentX + 4,
          oldY: currentY + 4,
          x: boundedPointX,
          y: point.y,
          width: boundedPointX - (currentX + 4),
          height: point.y ? point.y - (currentY + 4) : 24,
          value: cell.item,
        })

        // Show cursor pointer on hover over chip item
        if (
          !readonly &&
          selected &&
          isBoxHovered(
            { x: currentX, y: currentY, width: boundedPointX - currentX, height: point.y ? point.y - currentY : 24 },
            mousePosition,
          )
        ) {
          setCursor('pointer')
        }

        const shouldMoveToNextLine = point?.nextLine || boundedPointX >= chipRightBoundary

        if (shouldMoveToNextLine) {
          if (line + 1 > maxLines) {
            currentX = boundedPointX
            flag = true
            break
          }

          currentX = initialX
          currentWidth = initialWidth
          currentY = point?.y && y !== point?.y && point?.y - y >= 28 ? point?.y : currentY + 28
          line += 1
        } else {
          currentWidth = Math.max(0, rightBoundary - boundedPointX)
          currentX = boundedPointX
        }
      } else {
        // Add rendered chip info in return data
        returnData.push({
          oldX: currentX + 4,
          oldY: currentY + 4,
          x: currentX + currentWidth,
          y: currentY + 24,
          width: currentWidth,
          height: 24,
          value: cell.item,
        })

        // Show cursor pointer on hover over chip item
        if (!readonly && selected && isBoxHovered({ x: currentX, y: currentY, width: currentWidth, height: 24 }, mousePosition)) {
          setCursor('pointer')
        }

        if (line + 1 > maxLines) {
          break
        }

        currentX = initialX
        currentY = currentY + 28

        currentWidth = initialWidth
        line += 1
      }

      if (line > maxLines) {
        break
      }

      count++
    }

    Object.assign(cellRenderStore, { ltar: returnData })

    if (flag && count < cells.length) {
      // ... 固定贴右边界绘制，而不是跟随当前 x，避免右侧留下不必要空白。
      const ellipsisX = rightBoundary
      renderSingleLineText(ctx, {
        x: ellipsisX,
        y,
        text: '...',
        maxWidth: ellipsisWidth,
        textAlign: 'right',
        verticalAlign: 'middle',
        fontFamily: '500 13px Inter',
        fillStyle: '#666',
        height,
      })
    }

    ctx.restore()

    if (selected) {
      const borderRadius = 6

      if (!readonly) {
        renderIconButton(ctx, {
          buttonX: x + width - 54,
          buttonY: y + 6,
          borderRadius,
          buttonSize,
          spriteLoader,
          mousePosition,
          icon: 'ncPlus',
          iconData: {
            size: 14,
            xOffset: 3,
            yOffset: 3,
            color: getColor(themeV4Colors.gray['700']),
          },
          setCursor,
          background: getColor(themeV4Colors.base.white),
          borderColor: getColor(themeV4Colors.gray['200']),
          hoveredBackground: getColor(themeV4Colors.gray['100']),
        })
      }

      renderIconButton(ctx, {
        buttonX: x + width - 30,
        buttonY: y + 6,
        borderRadius,
        buttonSize,
        spriteLoader,
        mousePosition,
        icon: 'maximize',
        setCursor,
        iconData: {
          size: 12,
          xOffset: 4,
          yOffset: 4,
          color: getColor(themeV4Colors.gray['700']),
        },
        background: getColor(themeV4Colors.base.white),
        borderColor: getColor(themeV4Colors.gray['200']),
        hoveredBackground: getColor(themeV4Colors.gray['100']),
      })
    }
  },
  async handleClick({
    row,
    column,
    getCellPosition,
    mousePosition,
    makeCellEditable,
    cellRenderStore,
    selected,
    isPublic,
    isDoubleClick,
    openDetachedExpandedForm,
  }) {
    if (!selected && !isDoubleClick) return false

    const rowIndex = row.rowMeta.rowIndex!
    const { x, y, width, height } = getCellPosition(column, rowIndex)

    /**
     * Note: The order of click action trigger is matter here to mimic behaviour of editable cell
     */

    /**
     * When user clicks on Maximize/Plus icon make cell editable
     * Open linked/unlinked record dropdown will handled in editable cell component
     */
    if (
      isBoxHovered({ x: x + width - 57, y: y + 4, height: buttonSize, width: buttonSize }, mousePosition) ||
      isBoxHovered({ x: x + width - 30, y: y + 4, height: buttonSize, width: buttonSize }, mousePosition)
    ) {
      makeCellEditable(row, column)
      return true
    }

    if ((selected || isDoubleClick) && ncIsArray(cellRenderStore?.ltar)) {
      // Value is array of object so we have to iterate over it
      for (const cellItem of cellRenderStore.ltar) {
        /**
         * Expand record on click chip item if cell is selected and user has permission to edit data (e.g, not readonly)
         */
        if (
          ncIsObject(cellItem.value) &&
          cellItem.width &&
          cellItem.height &&
          isBoxHovered(
            {
              x: cellItem.oldX!,
              y: cellItem.oldY!,
              height: cellItem.height,
              width: cellItem.width,
            },
            mousePosition,
          )
        ) {
          /**
           * To mimic editable cell behaviour we added return statement here
           * If isPublic (stop event propagation on click chip item) `@click.stop="openExpandedForm"`
           */
          if (isPublic) return true

          const rowId = extractPkFromRow(cellItem.value, (column.relatedTableMeta?.columns || []) as ColumnType[])

          if (rowId) {
            openDetachedExpandedForm({
              isOpen: true,
              row: { row: cellItem.value, rowMeta: {}, oldRow: { ...cellItem.value } },
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
      }
    }

    /**
     * This is same as `cellClickHook`, on click cell make cell editable
     */
    if ((selected || isDoubleClick) && isBoxHovered({ x, y, width, height }, mousePosition)) {
      makeCellEditable(row, column)
      return true
    }

    return false
  },
  handleHover: async (props) => {
    const { row, column, mousePosition, getCellPosition, t, selected } = props

    if (!selected) return

    const { tryShowTooltip, hideTooltip } = useTooltipStore()
    hideTooltip()

    const rowIndex = row.rowMeta.rowIndex!
    const { x, y, width } = getCellPosition(column, rowIndex)

    const box = { x: x + width - 30, y: y + 4, width: buttonSize, height: buttonSize }

    tryShowTooltip({ rect: box, mousePosition, text: t('tooltip.expandShiftSpace') })
  },
}
