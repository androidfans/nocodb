import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import { type TimeZone } from '@vvo/tzdb'
import { isCreatedOrLastModifiedTimeCol } from 'nocodb-sdk'
import { isBoxHovered, truncateText } from '../utils/canvas'
import { timeFormatsObj } from '../utils/cell'

dayjs.extend(utc)

export const DateTimeCellRenderer: CellRenderer = {
  render: (ctx, { value, x, y, width, height, selected, pv, column, padding, readonly, getColor }) => {
    ctx.font = `${pv ? 600 : 500} 13px Inter`
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'

    const columnMeta = parseProp(column?.meta)
    const dateFormat = columnMeta?.date_format ?? 'YYYY-MM-DD'
    const timeFormat = columnMeta?.time_format ?? 'HH:mm'
    const timezone = column?.extra?.timezone as TimeZone
    const isDisplayTimezone = column?.extra?.isDisplayTimezone as TimeZone

    const is12hrFormat = columnMeta?.is12hrFormat
    const isValueValid = value && dayjs(value).isValid()
    // 旧实现把日期/时间硬拆成固定比例宽度，导致“右侧还有很多空间却提前省略”。
    // 新实现先按真实文本宽度计算，再决定单行或换行，保证列宽利用率更接近用户直觉。
    const timezoneAbbr = isValueValid && isDisplayTimezone && timezone?.abbreviation ? timezone.abbreviation : ''
    const timezoneWidth = timezoneAbbr ? ctx.measureText(timezoneAbbr).width + 8 : 0
    const sectionGap = 4
    const timezoneGap = timezoneWidth ? 4 : 0
    const contentStartX = x + padding
    const totalAvailableWidth = Math.max(0, width - padding * 2)
    const dateTimeWidth = Math.max(0, totalAvailableWidth - timezoneWidth - timezoneGap)
    const topLineY = y + 16

    let dateTimeValue
    if (isValueValid) {
      if (timezone) {
        const { timezonize: timezonizeDayjs } = withTimezone(timezone.name)

        dateTimeValue = timezonizeDayjs(dayjs(value))
      } else {
        dateTimeValue = dayjs(value).utc().local()
      }
    }

    const dateStr = dateTimeValue?.format(dateFormat) ?? ''
    const timeStr = dateTimeValue?.format(is12hrFormat ? timeFormatsObj[timeFormat] : timeFormat) ?? ''

    const isPlaceholder = !value && selected && !readonly
    const dateDisplay = isPlaceholder ? dateFormat : dateStr
    const timeDisplay = isPlaceholder ? timeFormat : timeStr
    if (!dateDisplay && !timeDisplay) return

    const dateMeasuredWidth = ctx.measureText(dateDisplay).width
    const timeMeasuredWidth = ctx.measureText(timeDisplay).width
    const hasDateTimeSections = Boolean(dateDisplay && timeDisplay)
    const effectiveGap = hasDateTimeSections ? sectionGap : 0
    const oneLineRequiredWidth = dateMeasuredWidth + effectiveGap + timeMeasuredWidth
    // 行高允许多行时，DateTime 可回退为两行（日期一行、时间一行），
    // 这能修复高行高场景下仍强制单行导致的信息损失。
    const canWrap = rowHeightTruncateLines(height) > 1
    const shouldWrap = canWrap && oneLineRequiredWidth > dateTimeWidth

    ctx.fillStyle = isPlaceholder
      ? getColor(themeV4Colors.gray['400'])
      : pv
      ? getColor(themeV4Colors.brand['500'])
      : getColor(themeV4Colors.gray['600'])
    if (isPlaceholder) {
      ctx.font = '400 13px Inter'
    }

    if (shouldWrap) {
      const lineHeight = 16
      const dateY = topLineY
      const timeY = topLineY + lineHeight

      const truncatedDate = truncateText(ctx, dateDisplay, dateTimeWidth)
      const timeLineText = timezoneAbbr ? `${timeDisplay} ${timezoneAbbr}` : timeDisplay
      const truncatedTime = truncateText(ctx, timeLineText, dateTimeWidth)

      ctx.fillText(truncatedDate, contentStartX, dateY)
      ctx.fillText(truncatedTime, contentStartX, timeY)
      return
    }

    const availableWidth = Math.max(0, dateTimeWidth - effectiveGap)
    let dateWidth = availableWidth
    let timeWidth = 0

    if (hasDateTimeSections) {
      if (oneLineRequiredWidth <= dateTimeWidth) {
        dateWidth = dateMeasuredWidth
        timeWidth = timeMeasuredWidth
      } else {
        // 单行放不下时按“文本真实占比”分配剩余宽度，
        // 避免原先固定 60/40 在某些格式下把某一段过度压缩。
        const totalMeasuredWidth = Math.max(1, dateMeasuredWidth + timeMeasuredWidth)
        dateWidth = Math.max(0, Math.round((dateMeasuredWidth / totalMeasuredWidth) * availableWidth))
        timeWidth = Math.max(0, availableWidth - dateWidth)
      }
    }

    const truncatedDate = truncateText(ctx, dateDisplay, dateWidth)
    const truncatedTime = truncateText(ctx, timeDisplay, timeWidth)
    const timeX = contentStartX + dateWidth + effectiveGap

    ctx.fillText(truncatedDate, contentStartX, topLineY)
    ctx.fillText(truncatedTime, timeX, topLineY)

    if (timezoneAbbr) {
      const oldFillStyle = ctx.fillStyle
      const oldFont = ctx.font
      ctx.font = `500 11px Inter`
      ctx.fillStyle = getColor(themeV4Colors.gray['500'])
      ctx.fillText(timezoneAbbr, contentStartX + dateTimeWidth + timezoneGap, topLineY)
      ctx.font = oldFont
      ctx.fillStyle = oldFillStyle
    }
  },

  async handleClick(ctx) {
    const { row, column, makeCellEditable, getCellPosition, mousePosition, selected } = ctx
    const bound = getCellPosition(column, row.rowMeta.rowIndex)
    if (!selected || column.readonly || isCreatedOrLastModifiedTimeCol(column.uidt)) return false

    // 旧逻辑只在“命中日期/时间文字区域”时可编辑，用户点击单元格空白会失效。
    // 这里统一为：命中整个 cell 边界即进入编辑，和其它类型单元格保持一致。
    if (mousePosition && isBoxHovered(bound, mousePosition)) {
      makeCellEditable(row, column)
      return true
    }

    return false
  },
  async handleKeyDown(ctx) {
    const { e, row, column, makeCellEditable } = ctx
    if (column.readonly || !column?.isCellEditable || column.isSyncedColumn || isCreatedOrLastModifiedTimeCol(column.uidt)) return
    if (e.key.length === 1) {
      makeCellEditable(row, column)
      return true
    }

    return false
  },
}
