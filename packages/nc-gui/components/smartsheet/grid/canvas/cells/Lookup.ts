import {
  NC_ERROR_SENTINEL,
  RelationTypes,
  UITypes,
  getMetaWithCompositeKey,
  isBtLikeV2Junction,
  isLinksOrLTAR,
  isVirtualCol,
} from 'nocodb-sdk'
import type { ColumnType, LinkToAnotherRecordType, LookupType, TableType } from 'nocodb-sdk'
import { getRelatedBaseId, getSingleMultiselectColOptions, getUserColOptions, renderAsCellLookupOrLtarValue } from '../utils/cell'
import { defaultOffscreen2DContext, isBoxHovered, renderCellError, renderSingleLineText } from '../utils/canvas'
import { PlainCellRenderer } from './Plain'

const renderOnly1Row = [UITypes.QrCode, UITypes.Barcode, UITypes.Attachment, UITypes.LinkToAnotherRecord, UITypes.Links]

const ellipsisWidth = 15

export const LookupCellRenderer: CellRenderer = {
  render: (ctx, props) => {
    const {
      column,
      x: _x,
      y: _y,
      value,
      renderCell,
      metas,
      meta,
      height,
      width: _width,
      padding = 10,
      tableMetaLoader,
      row,
      cellRenderStore,
      mousePosition,
      selected,
      setCursor,
      getColor,
    } = props
    let x = _x
    let y = _y
    // 用固定右边界统一计算剩余宽度，避免多次扣减后出现“右侧空白越来越大”。
    const rightBoundary = _x + _width
    let width = Math.max(0, rightBoundary - x)

    if (parseProp(column.colOptions)?.error || value === NC_ERROR_SENTINEL) {
      renderCellError(ctx, { x, y, width: _width, height, padding, getColor })
      return
    }

    // If it is empty text then no need to render
    if (!metas) return

    const colOptions = column.colOptions as LookupType

    const relatedColObj = getMetaWithCompositeKey(metas, meta?.base_id, column.fk_model_id)?.columns?.find(
      (c: any) => c.id === (column?.colOptions as LookupType)?.fk_relation_column_id,
    ) as ColumnType

    if (!relatedColObj) return

    const relatedColOptions = relatedColObj.colOptions as LinkToAnotherRecordType
    if (!relatedColOptions) return
    const relatedColType = (relatedColObj.colOptions as LinkToAnotherRecordType)?.type

    // Get the correct base ID for the related table (handles cross-base links)
    const relatedBaseId = getRelatedBaseId(relatedColObj, meta?.base_id || '')
    const relatedTableMeta = getMetaWithCompositeKey(metas, relatedBaseId, relatedColOptions.fk_related_model_id)

    // Load related table meta if not present
    if (!relatedTableMeta) {
      const relatedModelId = relatedColOptions.fk_related_model_id
      if (!relatedModelId) return

      if (tableMetaLoader.isLoading(relatedModelId, relatedBaseId)) return

      tableMetaLoader.getTableMeta(relatedModelId, relatedBaseId)

      return
    }

    const lookupColumn = (relatedTableMeta?.columns || []).find((c: ColumnType) => c.id === colOptions?.fk_lookup_column_id)

    if (!lookupColumn || lookupColumn?.uidt === UITypes.Button) return

    y =
      y +
      (renderOnly1Row.includes(lookupColumn.uidt) &&
      lookupColumn.uidt !== UITypes.Attachment &&
      // Lookup 下的 Link/Links 需要维持顶部对齐，否则会出现“同列里只有它垂直居中”的错位。
      ![UITypes.LinkToAnotherRecord, UITypes.Links].includes(lookupColumn.uidt)
        ? Math.floor(height / 2 - rowHeightInPx['1']! / 2)
        : 0)

    if ([UITypes.SingleSelect, UITypes.MultiSelect].includes(lookupColumn.uidt)) {
      lookupColumn.extra = getSingleMultiselectColOptions(lookupColumn)
    } else if ([UITypes.User, UITypes.CreatedBy, UITypes.LastModifiedBy].includes(lookupColumn.uidt)) {
      lookupColumn.extra = getUserColOptions(lookupColumn, props.baseUsers || [])
    }

    const getArrValue = () => {
      if (
        lookupColumn.uidt === UITypes.Checkbox &&
        relatedColType &&
        [RelationTypes.BELONGS_TO, RelationTypes.ONE_TO_ONE].includes(relatedColType as RelationTypes)
      ) {
        const hasLink = !!(row && relatedColObj?.title && row[relatedColObj.title])

        if (!value && !hasLink) return []

        return (ncIsArray(value) ? value : [value]).map(getCheckBoxValue)
      }

      if (ncIsNullOrUndefined(value)) return []

      if (lookupColumn.uidt === UITypes.Attachment) {
        if (relatedColType && [RelationTypes.BELONGS_TO, RelationTypes.ONE_TO_ONE].includes(relatedColType as RelationTypes)) {
          return ncIsArray(value) ? value : [value]
        }

        if (
          ncIsArray(value) &&
          value.every((v) => {
            if (ncIsNull(v)) return true

            if (ncIsArray(v)) {
              return !v.length || ncIsObject(v[0])
            }

            return false
          })
        ) {
          return value
            .filter((v) => v !== null)
            .reduce((acc, v) => {
              acc.push(...v)

              return acc
            }, [])
        }
      }

      if (ncIsArray(value)) {
        return value.filter((v) => v !== null)
      }

      return [value]
    }

    const arrValue = getArrValue()

    if (!arrValue.length) return

    const isTemporalLookup = [
      UITypes.Date,
      UITypes.DateTime,
      UITypes.Time,
      UITypes.Year,
      UITypes.CreatedTime,
      UITypes.LastModifiedTime,
    ].includes(lookupColumn.uidt)
    const isLongTextLookup = lookupColumn.uidt === UITypes.LongText
    const isCompactLookupTag = Boolean((isTemporalLookup || isLongTextLookup) && arrValue.length === 1)

    // Begin clipping
    ctx.save()
    ctx.beginPath()
    ctx.rect(_x, _y, _width, height) // Define the clipping rectangle
    ctx.clip()

    let lkRelatedTableMeta: TableType | undefined

    // if lookup column is LTAR/Links then extract the related table meta
    const lkRelatedModelId = (lookupColumn.colOptions as LinkToAnotherRecordType)?.fk_related_model_id

    if (isLinksOrLTAR(lookupColumn) && lkRelatedModelId) {
      // Get the correct base ID for the lookup column's related table (handles cross-base links)
      const lkRelatedBaseId = (lookupColumn.colOptions as LinkToAnotherRecordType)?.fk_related_base_id || relatedBaseId
      lkRelatedTableMeta = getMetaWithCompositeKey(metas, lkRelatedBaseId, lkRelatedModelId)

      // Load related table meta if not present
      if (!lkRelatedTableMeta) {
        // Restore canvas context before returning — ctx.save()/ctx.clip() was already called above
        ctx.restore()

        if (tableMetaLoader.isLoading(lkRelatedModelId, lkRelatedBaseId)) return

        tableMetaLoader.getTableMeta(lkRelatedModelId, lkRelatedBaseId)

        return
      }
    }

    Object.assign(cellRenderStore, {
      // 在 handleHover/handleClick 里复用渲染期结果，避免重新推断数据结构导致命中不一致。
      ltarRelatedTableMeta: lkRelatedTableMeta,
      lookupArrValue: arrValue,
    })

    const renderProps: CellRendererOptions = {
      ...props,
      column: lookupColumn,
      relatedColObj: undefined,
      relatedTableMeta: lkRelatedTableMeta,
      isUnderLookup: true,
      readonly: true,
      value: arrValue,
      height: isAttachment(lookupColumn) ? height : rowHeightInPx['1']!,
      // 单值时间/长文本 lookup 采用紧凑胶囊，目的是修复“右侧明明还有空间却提前省略”。
      padding: isCompactLookupTag ? 2 : 10,
      tag: {
        renderAsTag: true,
        tagBgColor: getColor(themeV4Colors.base.white),
        tagHeight: 20,
        tagBorderColor: getColor(themeV4Colors.gray['200']),
        tagBorderWidth: 1,
        tagPaddingX: isCompactLookupTag ? 2 : 8,
        tagPaddingLeft: isCompactLookupTag ? 3 : undefined,
        tagPaddingRight: isCompactLookupTag ? 1 : undefined,
        tagSpacing: isCompactLookupTag ? 4 : 4,
      },
      meta: relatedTableMeta,
      textAlign: isAttachment(lookupColumn) ? 'center' : props.textAlign,
      textColor: getColor(themeV4Colors.gray['700']),
    }

    const lookupRenderer = (options: CellRendererOptions) => {
      return renderAsCellLookupOrLtarValue.includes(lookupColumn.uidt) || isRichText(lookupColumn)
        ? renderCell(ctx, lookupColumn, options)
        : PlainCellRenderer.render(ctx, options)
    }
    const measureLookupRenderer = (options: CellRendererOptions) => {
      // 离屏测量用于“先判定是否换行再渲染”，避免换行过程中 chip 反复抖动。
      return renderAsCellLookupOrLtarValue.includes(lookupColumn.uidt) || isRichText(lookupColumn)
        ? renderCell(defaultOffscreen2DContext, lookupColumn, options)
        : PlainCellRenderer.render(defaultOffscreen2DContext, options)
    }

    const maxLines = rowHeightTruncateLines(height, true)
    let line = 1
    let flag = false
    let count = 1
    const fullRowWidth = Math.max(0, rightBoundary - _x)

    const shouldWrapBeforeRender = (v: any) => {
      if (renderOnly1Row.includes(lookupColumn.uidt) || x === _x) return false

      const measurePoint = measureLookupRenderer({
        ...renderProps,
        value: v,
        x: 0,
        y: 0,
        width: fullRowWidth,
      })
      const measuredWidth = Math.max(0, (measurePoint?.x ?? 0) - 0)
      // Link/LTAR 渲染返回点位会有轻微浮动，给容差避免“宽度刚好临界时来回换行”。
      const wrapTolerance = isLinksOrLTAR(lookupColumn) ? 4 : 0

      return measuredWidth > width + wrapTolerance
    }

    const handleRenderEllipsis = () => {
      if (x === _x) return
      // ... 始终限制在 cell 右边界内，防止在窄宽度下越界或和 chip 重叠。
      const ellipsisX = Math.max(_x, Math.min(x + padding, rightBoundary - ellipsisWidth))

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

    const handleRenderVirtualCol = () => {
      for (const v of arrValue) {
        if (shouldWrapBeforeRender(v)) {
          if (line + 1 > maxLines || renderOnly1Row.includes(lookupColumn.uidt)) {
            flag = true
            break
          }

          x = _x
          width = Math.max(0, rightBoundary - x)
          y += 24
          line += 1
        }

        const point = lookupRenderer({
          ...renderProps,
          value: v,
          x,
          y,
          width,
          tag: { ...renderProps.tag, renderAsTag: renderOnly1Row.includes(lookupColumn.uidt) },
        })

        if (renderOnly1Row.includes(lookupColumn.uidt)) {
          if (point?.x) {
            x = point?.x
          }
        } else if (point?.x) {
          if (point?.nextLine || point?.x > rightBoundary) {
            if (line + 1 > maxLines || renderOnly1Row.includes(lookupColumn.uidt)) {
              flag = true
              break
            }

            x = _x
            width = Math.max(0, rightBoundary - x)
            y = point?.y && y !== point?.y && point?.y - y >= 24 ? point?.y : y + 24
            line += 1
          } else {
            const nextX = Math.min(point?.x, rightBoundary)
            width = Math.max(0, rightBoundary - nextX)
            x = nextX
          }
        } else {
          if (line + 1 > maxLines || renderOnly1Row.includes(lookupColumn.uidt)) {
            break
          }

          x = _x
          y += 24
          width = Math.max(0, rightBoundary - x)
          line += 1
        }
        count += 1
      }

      if (flag && count < arrValue.length) {
        handleRenderEllipsis()
      }
    }

    const handleRenderDefault = () => {
      for (const v of arrValue) {
        if (shouldWrapBeforeRender(v)) {
          if (line + 1 > maxLines || renderOnly1Row.includes(lookupColumn.uidt)) {
            flag = true
            break
          }

          x = _x
          width = Math.max(0, rightBoundary - x)
          y += 24
          line += 1
        }

        const point = lookupRenderer({ ...renderProps, value: v, x, y, width })

        if (renderOnly1Row.includes(lookupColumn.uidt)) {
          if (point?.x) {
            x = point?.x
          }
        } else if (point?.x && !point?.nextLine) {
          if (point?.x > rightBoundary) {
            if (line + 1 > maxLines || renderOnly1Row.includes(lookupColumn.uidt)) {
              flag = true

              if (point?.x) {
                x = Math.min(rightBoundary - ellipsisWidth, point?.x + padding)
              } else {
                x = _x + _width - padding - ellipsisWidth
              }

              break
            }

            x = _x
            width = Math.max(0, rightBoundary - x)
            y = point?.y && y !== point?.y && point?.y - y >= 24 ? point?.y : y + 24
            line += 1
          } else {
            const nextX = Math.min(point?.x, rightBoundary)
            width = Math.max(0, rightBoundary - nextX)
            x = nextX
          }
        } else {
          if (line + 1 > maxLines || renderOnly1Row.includes(lookupColumn.uidt)) {
            if (!point?.nextLine) {
              flag = true
            }
            break
          }

          x = _x
          y += 24
          width = Math.max(0, rightBoundary - x)
          line += 1
        }

        if (line > maxLines) {
          flag = true

          break
        }
        count++
      }

      if (flag && count < arrValue.length) {
        handleRenderEllipsis()
      }
    }

    if (isVirtualCol(lookupColumn) && ![UITypes.Rollup, UITypes.Formula].includes(lookupColumn.uidt)) {
      if (
        lookupColumn.uidt !== UITypes.LinkToAnotherRecord ||
        (lookupColumn.uidt === UITypes.LinkToAnotherRecord &&
          (isBtLikeV2Junction(lookupColumn) ||
            [RelationTypes.BELONGS_TO, RelationTypes.ONE_TO_ONE].includes(lookupColumn.colOptions?.type)))
      ) {
        handleRenderVirtualCol()
      } else {
        lookupRenderer({
          ...renderProps,
          tag: { ...renderProps.tag, renderAsTag: false },
        })
      }
    } else {
      if (isAttachment(lookupColumn) && ncIsObject(arrValue[0])) {
        renderCell(ctx, lookupColumn, {
          ...renderProps,
          tag: { ...renderProps.tag, renderAsTag: false },
        })
      } else {
        handleRenderDefault()
      }
    }

    if (selected && isLinksOrLTAR(lookupColumn)) {
      if (ncIsArray(cellRenderStore?.ltar)) {
        for (const cellItem of cellRenderStore.ltar) {
          if (
            ncIsObject(cellItem.value) &&
            isBoxHovered(
              {
                x: cellItem.oldX!,
                y: cellItem.oldY!,
                width: Math.max(0, cellItem.width || 0),
                height: Math.max(0, cellItem.height || 0),
              },
              mousePosition,
            )
          ) {
            setCursor('pointer')
            break
          }
        }
      } else if (relatedTableMeta && ncIsArray(cellRenderStore?.lookupArrValue)) {
        // lookup 结果只有单个对象且未走 ltar 数组路径时，兜底一个可点击命中框，
        // 避免“视觉上是 chip，但鼠标不变手型/无法点击”的体验断层。
        const firstLookupValue = cellRenderStore.lookupArrValue.find((v) => ncIsObject(v))
        const fallbackChipWidth =
          typeof cellRenderStore?.x === 'number' ? Math.max(0, cellRenderStore.x - (_x + 4)) : Math.max(0, _width - 8)
        const chipWidth = Math.max(0, (cellRenderStore?.width as number) || fallbackChipWidth)
        const chipHeight = Math.max(0, (cellRenderStore?.height as number) || rowHeightInPx['1']! || 24)
        if (
          firstLookupValue &&
          isBoxHovered(
            {
              x: _x + 4,
              y: _y + (rowHeightInPx['1'] === height ? 0 : 2),
              width: chipWidth,
              height: chipHeight,
            },
            mousePosition,
          )
        ) {
          setCursor('pointer')
        }
      }
    }

    // Restore context after clipping
    ctx.restore()
  },
  async handleKeyDown(ctx) {
    const { e, row, column, makeCellEditable } = ctx
    if (e.key === 'Enter' || isExpandCellKey(e)) {
      makeCellEditable(row, column)
      return true
    }

    return false
  },
  async handleClick({
    row,
    value,
    column,
    getCellPosition,
    mousePosition,
    cellRenderStore,
    selected,
    isPublic,
    isDoubleClick,
    openDetachedExpandedForm,
  }) {
    if (!selected && !isDoubleClick) return false

    const rowIndex = row.rowMeta.rowIndex!
    const { x, y, width, height } = getCellPosition(column, rowIndex)

    const relatedTableMeta = cellRenderStore?.ltarRelatedTableMeta as TableType | undefined

    if ((selected || isDoubleClick) && ncIsArray(cellRenderStore?.ltar) && relatedTableMeta) {
      // 优先走逐 chip 命中，保证多值 lookup 的点击行为与原生 LTAR 一致。
      for (const cellItem of cellRenderStore.ltar) {
        if (
          ncIsObject(cellItem.value) &&
          isBoxHovered(
            {
              x: cellItem.oldX!,
              y: cellItem.oldY!,
              height: Math.max(0, cellItem.height || 0),
              width: Math.max(0, cellItem.width || 0),
            },
            mousePosition,
          )
        ) {
          if (isPublic) return true

          const rowId = extractPkFromRow(cellItem.value, (relatedTableMeta?.columns || []) as ColumnType[])

          if (rowId) {
            openDetachedExpandedForm({
              isOpen: true,
              row: { row: cellItem.value, rowMeta: {}, oldRow: { ...cellItem.value } },
              meta: relatedTableMeta || ({} as TableType),
              rowId,
              useMetaFields: true,
              maintainDefaultViewOrder: true,
              loadRow: !isPublic,
            })
          }

          return true
        }
      }
    }

    const lookupValues = ncIsArray(cellRenderStore?.lookupArrValue)
      ? cellRenderStore.lookupArrValue
      : ncIsArray(value)
      ? value
      : [value]
    const firstLookupValue = lookupValues.find((v) => ncIsObject(v))
    const fallbackChipWidth =
      typeof cellRenderStore?.x === 'number' ? Math.max(0, cellRenderStore.x - (x + 4)) : Math.max(0, width - 8)
    const chipWidth = Math.max(0, (cellRenderStore?.width as number) || fallbackChipWidth)
    const chipHeight = Math.max(0, (cellRenderStore?.height as number) || rowHeightInPx['1']! || 24)

    if (
      (selected || isDoubleClick) &&
      ncIsObject(firstLookupValue) &&
      relatedTableMeta &&
      // 单值兜底命中：兼容“没有 ltar 渲染元数据但值是对象”的 lookup 场景。
      isBoxHovered(
        {
          x: x + 4,
          y: y + (rowHeightInPx['1'] === height ? 0 : 2),
          width: chipWidth,
          height: chipHeight,
        },
        mousePosition,
      )
    ) {
      if (isPublic) return true

      const rowId = extractPkFromRow(firstLookupValue, (relatedTableMeta?.columns || []) as ColumnType[])

      if (rowId) {
        openDetachedExpandedForm({
          isOpen: true,
          row: { row: firstLookupValue, rowMeta: {}, oldRow: { ...firstLookupValue } },
          meta: relatedTableMeta || ({} as TableType),
          rowId,
          useMetaFields: true,
          maintainDefaultViewOrder: true,
          loadRow: !isPublic,
        })
      }

      return true
    }

    return false
  },
}
