// Shared by native LTAR cells and Lookup-of-Link chips. Keep line allocation
// separate from drawing so measurement never decides which record a click opens.
export const minChipTextSafeWidth = 72
const chipSpacing = 2

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

export function layoutChipLines(chipIdealWidths: number[], initialWidth: number, maxLines: number, ellipsisWidth = 15) {
  const lines: { widths: number[]; reserveEllipsisWidth: number }[] = []
  let cellIndex = 0
  for (let line = 1; line <= maxLines && cellIndex < chipIdealWidths.length; line++) {
    const isLastLine = line === maxLines
    const remainingLines = maxLines - line + 1
    const remaining = chipIdealWidths.length - cellIndex

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

    const chipRightBoundary = initialWidth - reserveEllipsisWidth
    const availableLineWidth = Math.max(minChipTextSafeWidth, chipRightBoundary)
    const lineIdealWidths = chipIdealWidths.slice(cellIndex, cellIndex + lineCellsCount)
    const lineAssignedWidths = flexShrinkWidths(lineIdealWidths, availableLineWidth, minChipTextSafeWidth)

    lines.push({ widths: lineAssignedWidths, reserveEllipsisWidth })
    cellIndex += lineCellsCount
  }
  return lines
}
