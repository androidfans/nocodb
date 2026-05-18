import type { ColumnType, LinkToAnotherRecordType, TableType } from 'nocodb-sdk'
import { defaultOffscreen2DContext, isBoxHovered, renderIconButton, renderSingleLineText } from '../../utils/canvas'
import { PlainCellRenderer } from '../Plain'
import { renderAsCellLookupOrLtarValue } from '../../utils/cell'
import type { UseExpandedFormDetachedProps } from '~/composables/useExpandedFormDetached'

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
    // 保证最差情况下仍能至少看见一个字符，避免 chip 被压成纯色块。
    const minChipTextSafeWidth = 72
    const chipSpacing = 2
    const measureMaxWidth = Math.max(initialWidth, 1200)
    const chipIdealWidths = cells.map((cell) => {
      const p = measureCellRenderer({
        ...renderProps,
        value: cell.value,
        x: 0,
        y: 0,
        width: measureMaxWidth,
      })
      return Math.max(minChipTextSafeWidth, p?.x ?? minChipTextSafeWidth)
    })
    const flexShrinkWidths = (idealWidths: number[], containerWidth: number, minWidth: number) => {
      if (!idealWidths.length) return []

      const widths = [...idealWidths]
      let total = widths.reduce((acc, w) => acc + w, 0)
      if (total <= containerWidth) return widths

      let overflow = total - containerWidth
      const frozen = new Array(widths.length).fill(false)

      while (overflow > 0.1) {
        let activeWeight = 0
        for (let i = 0; i < widths.length; i++) {
          if (!frozen[i]) activeWeight += widths[i]!
        }
        if (activeWeight <= 0) break

        let consumed = 0
        for (let i = 0; i < widths.length; i++) {
          if (frozen[i]) continue
          const current = widths[i]!
          const shrink = overflow * (current / activeWeight)
          const next = Math.max(minWidth, current - shrink)
          consumed += current - next
          widths[i] = next
        }

        overflow -= consumed
        if (consumed <= 0.1) break

        for (let i = 0; i < widths.length; i++) {
          if (!frozen[i] && widths[i]! <= minWidth + 0.1) {
            frozen[i] = true
            widths[i] = minWidth
          }
        }
      }

      total = widths.reduce((acc, w) => acc + w, 0)
      if (total > containerWidth) {
        let extra = total - containerWidth
        for (let i = widths.length - 1; i >= 0 && extra > 0; i--) {
          const current = widths[i]!
          if (current <= minWidth) continue
          const reducible = current - minWidth
          const cut = Math.min(reducible, extra)
          widths[i] = current - cut
          extra -= cut
        }
      }

      return widths
    }

    let flag = false
    let hasHiddenItems = false
    let cellIndex = 0

    for (let line = 1; line <= maxLines && cellIndex < cells.length; line++) {
      const isLastLine = line === maxLines
      const remainingLines = maxLines - line + 1
      const lineY = y + (rowHeightInPx['1'] === height ? 0 : 2) + (line - 1) * 28
      const remaining = cells.length - cellIndex

      let reserveEllipsisWidth = 0
      const maxChipsPerLine = Math.max(1, Math.floor((initialWidth + chipSpacing) / (minChipTextSafeWidth + chipSpacing)))
      let lineCellsCount = 1

      if (isLastLine) {
        const lastLineCapacityNoEllipsis = Math.max(
          1,
          Math.floor((initialWidth + chipSpacing) / (minChipTextSafeWidth + chipSpacing)),
        )
        if (remaining > lastLineCapacityNoEllipsis) {
          reserveEllipsisWidth = ellipsisWidth + 1
        }
        const lastLineCapacity = Math.max(
          1,
          Math.floor((Math.max(0, initialWidth - reserveEllipsisWidth) + chipSpacing) / (minChipTextSafeWidth + chipSpacing)),
        )
        lineCellsCount = Math.min(remaining, lastLineCapacity)
      } else {
        // 非最后一行：在“容量上限”基础上，用 balance 软阈值控制分行，避免所有 chip 挤在第一行。
        const maxCountByFeasibility = Math.max(1, remaining - (remainingLines - 1))
        const hardLimit = Math.max(1, Math.min(maxChipsPerLine, maxCountByFeasibility))
        // 平衡下限：尽量把剩余 chip 均摊到剩余行，避免出现 1-1-4 这类“前瘦后胖”分布。
        const balancedMinCount = Math.max(1, Math.min(hardLimit, Math.ceil(remaining / remainingLines)))
        const remainingIdealTotal = chipIdealWidths
          .slice(cellIndex)
          .reduce((acc, w, idx) => acc + w + (idx > 0 ? chipSpacing : 0), 0)
        const softLineWidth =
          remainingLines > 1
            ? Math.max(minChipTextSafeWidth, Math.min(initialWidth, remainingIdealTotal / remainingLines))
            : initialWidth

        let lineIdealWidth = 0
        let count = 0
        while (count < hardLimit) {
          const w = chipIdealWidths[cellIndex + count]!
          const nextWidth = lineIdealWidth + (count > 0 ? chipSpacing : 0) + w
          if (count > 0 && nextWidth > softLineWidth) break
          lineIdealWidth = nextWidth
          count++
        }
        lineCellsCount = Math.max(balancedMinCount, count)
      }

      const chipRightBoundary = rightBoundary - reserveEllipsisWidth
      const availableLineWidth = Math.max(minChipTextSafeWidth, chipRightBoundary - initialX)
      const lineIdealWidths = chipIdealWidths.slice(cellIndex, cellIndex + lineCellsCount)
      const lineAssignedWidths = flexShrinkWidths(lineIdealWidths, availableLineWidth, minChipTextSafeWidth)

      currentX = initialX
      currentY = lineY

      for (let j = 0; j < lineCellsCount; j++) {
        const cell = cells[cellIndex + j]!
        const widthCap = Math.max(minChipTextSafeWidth, lineAssignedWidths[j] ?? minChipTextSafeWidth)
        const point = cellRenderer({
          ...renderProps,
          value: cell.value,
          x: currentX,
          y: currentY,
          width: widthCap,
        })

        const cellRightBoundary = Math.min(chipRightBoundary, currentX + widthCap)
        const boundedPointX = point?.x
          ? Math.min(point.x + chipEndCompensation, cellRightBoundary)
          : Math.min(currentX + widthCap, cellRightBoundary)

        returnData.push({
          oldX: currentX + 4,
          oldY: currentY + 4,
          x: boundedPointX,
          y: point?.y ?? currentY + 24,
          width: boundedPointX - (currentX + 4),
          height: point?.y ? point.y - (currentY + 4) : 24,
          value: cell.item,
        })

        if (
          !readonly &&
          selected &&
          isBoxHovered(
            { x: currentX, y: currentY, width: boundedPointX - currentX, height: point?.y ? point.y - currentY : 24 },
            mousePosition,
          )
        ) {
          setCursor('pointer')
        }

        currentX = boundedPointX
      }

      cellIndex += lineCellsCount

      if (isLastLine && cellIndex < cells.length) {
        flag = true
        hasHiddenItems = true
        break
      }
    }

    Object.assign(cellRenderStore, { ltar: returnData })

    if (flag && hasHiddenItems) {
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
            const relatedColumns = (column.relatedTableMeta?.columns || []) as ColumnType[]
            const fullCellValue = column.title ? row.row[column.title] : undefined
            // Prefer the full cell value so keyboard navigation can reach
            // linked records that were not rendered as visible canvas chips.
            const siblings = ncIsArray(fullCellValue)
              ? fullCellValue.filter((item) => ncIsObject(item))
              : cellRenderStore.ltar.filter((item) => ncIsObject(item.value)).map((item) => item.value)
            const state = reactive<UseExpandedFormDetachedProps>({
              isOpen: true,
              row: { row: cellItem.value, rowMeta: {}, oldRow: { ...cellItem.value } },
              meta: column.relatedTableMeta || ({} as TableType),
              rowId,
              useMetaFields: true,
              maintainDefaultViewOrder: true,
              loadRow: !isPublic,
              showNextPrevIcons: siblings.length > 1,
              firstRow: false,
              lastRow: false,
            })

            const { updateSiblingState, findCurrentSiblingIndex, navigateSibling } = useExpandedFormSiblingNavigation({
              state,
              siblings,
              columns: relatedColumns,
            })
            state.next = () => navigateSibling(1)
            state.prev = () => navigateSibling(-1)

            updateSiblingState(findCurrentSiblingIndex())
            openDetachedExpandedForm(state)
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
