import {
  ClientType,
  SqlUiFactory,
  UITypes,
  comparisonOpList,
  comparisonSubOpList,
  deleteFilterWithSub,
  getEquivalentUIType,
  getFilterCount,
  getPlaceholderNewRow,
  isBtLikeV2Junction,
  isComparisonOpAllowed,
  isDateType,
  isSystemColumn,
  isVirtualCol,
  parseProp,
} from 'nocodb-sdk'
import type {
  ColumnType,
  ColumnTypeForFilter,
  ComparisonOpUiType,
  FilterGroupChangeEvent,
  FilterRowChangeEvent,
  LinkToAnotherRecordType,
  LookupType,
  TableType,
} from 'nocodb-sdk'

export const MAX_NESTED_LEVEL = 5
export const excludedFilterColUidt = [UITypes.QrCode, UITypes.Barcode, UITypes.Button]

// Re-export types from nocodb-sdk for backward compatibility
export type { ComparisonOpUiType, FilterGroupChangeEvent, FilterRowChangeEvent, ColumnTypeForFilter }

// Re-export functions from nocodb-sdk for backward compatibility
export {
  isDateType,
  comparisonOpList,
  comparisonSubOpList,
  getPlaceholderNewRow,
  isComparisonOpAllowed,
  getFilterCount,
  deleteFilterWithSub,
}

export const isComparisonSubOpAllowed = (
  filter: ColumnFilterType,
  compOp: {
    text: string
    value: string
    ignoreVal?: boolean
    includedTypes?: UITypes[]
    excludedTypes?: UITypes[]
  },
  uidt?: UITypes,
) => {
  if (compOp.includedTypes) {
    // include allowed values only if selected column type matches
    return filter.fk_column_id && compOp.includedTypes.includes(uidt!)
  } else if (compOp.excludedTypes) {
    // include not allowed values only if selected column type not matches
    return filter.fk_column_id && !compOp.excludedTypes.includes(uidt!)
  }
}

// filter is draft if it's not saved to db yet
export const isFilterDraft = (filter: Filter, col: ColumnTypeForFilter) => {
  if (filter.id) return false

  if (
    filter.comparison_op &&
    comparisonSubOpList(filter.comparison_op, parseProp(col?.meta)?.date_format).find(
      (compOp) => compOp.value === filter.comparison_sub_op,
    )?.ignoreVal
  ) {
    return false
  }

  if (
    comparisonOpList((col.filterUidt ?? col.uidt) as UITypes, parseProp(col?.meta)?.date_format).find(
      (compOp) => compOp.value === filter.comparison_op,
    )?.ignoreVal
  ) {
    return false
  }

  if (filter.value) {
    return false
  }

  return true
}

export const isDynamicFilterAllowed = (filter: ColumnFilterType, column?: ColumnType, dbClientType?: ClientType) => {
  if (!column) {
    return false
  }
  // if virtual column, don't allow dynamic filter
  if (isVirtualCol(column)) return false
  const sqlUi = SqlUiFactory.create({ client: dbClientType ?? ClientType.PG })

  // disable dynamic filter for certain fields like rating, attachment, etc
  if (
    [
      UITypes.Attachment,
      UITypes.Rating,
      UITypes.Checkbox,
      UITypes.QrCode,
      UITypes.Barcode,
      UITypes.Collaborator,
      UITypes.GeoData,
      UITypes.SpecificDBType,
    ].includes(column.uidt as UITypes)
  )
    return false

  const abstractType = sqlUi.getAbstractType(column)

  if (!['integer', 'float', 'text', 'string'].includes(abstractType)) return false

  return !filter.comparison_op || ['eq', 'lt', 'gt', 'lte', 'gte', 'like', 'nlike', 'neq'].includes(filter.comparison_op)
}

export const getDynamicColumns = (metaColumns: ColumnType[], column?: ColumnType, dbClientType?: ClientType) => {
  if (!column) return []
  const sqlUi = SqlUiFactory.create({ client: dbClientType ?? ClientType.PG })

  return metaColumns.filter((c: ColumnType) => {
    if (excludedFilterColUidt.includes(c.uidt as UITypes) || isVirtualCol(c) || (isSystemColumn(c) && !c.pk)) {
      return false
    }

    const dynamicColAbstractType = sqlUi.getAbstractType(c)

    const filterColAbstractType = sqlUi.getAbstractType(column)

    // treat float and integer as number
    if ([dynamicColAbstractType, filterColAbstractType].every((type) => ['float', 'integer'].includes(type))) {
      return true
    }

    // treat text and string as string
    if ([dynamicColAbstractType, filterColAbstractType].every((type) => ['text', 'string'].includes(type))) {
      return true
    }

    return filterColAbstractType === dynamicColAbstractType
  })
}

export const getFilterUidt = (col: ColumnTypeForFilter): UITypes => {
  // V2 MO/OO with deprecated Links uidt → normalize to LinkToAnotherRecord
  // (the current/active type) so filter routing treats them uniformly.
  if (col.uidt === UITypes.Links && isBtLikeV2Junction(col)) {
    return UITypes.LinkToAnotherRecord
  }
  if (col.uidt === UITypes.Formula) {
    const formulaUIType = getEquivalentUIType({
      formulaColumn: col,
    })

    return (formulaUIType || col.uidt) as UITypes
  }
  // if column is a lookup column, then use the lookup type extracted from the column
  else if (col.btLookupColumn) {
    return getFilterUidt(col.btLookupColumn as ColumnTypeForFilter)
  } else {
    return col.uidt as UITypes
  }
}

// Record-id filter operators for link columns. Used by FilterInput,
// InputLite, FilterRow, and FilterGroup to detect when the filter
// input should render a record picker instead of text/number input,
// and when operator switching should clear the filter value.
export const RECORD_FILTER_OPS = new Set(['eq_id', 'neq_id', 'in_id', 'nin_id'])

// Resolve the "real" column that a filter input should render for.
// For lookup columns, follows the chain to the terminal column so the
// filter input component matches the actual data type (e.g. a lookup
// pointing to a Links field renders a record picker, not a text box).
export const getFilterInputColumn = (column?: ColumnTypeForFilter | ColumnType): ColumnTypeForFilter | ColumnType | undefined => {
  if (!column) return undefined

  // Non-lookup columns: return as-is, no uidt override needed.
  // Only lookup columns need resolution to their terminal column type.
  if (!(column as ColumnTypeForFilter).btLookupColumn) return column

  const filterColumn = { ...(column as ColumnTypeForFilter).btLookupColumn } as ColumnTypeForFilter
  const filterUidt = (column as ColumnTypeForFilter).filterUidt ?? getFilterUidt(filterColumn as ColumnTypeForFilter)
  ;(filterColumn as any).uidt = filterUidt
  ;(filterColumn as any).filterUidt = filterUidt

  return filterColumn
}

export const composeColumnsForFilter = async ({
  rootMeta,
  getMeta,
}: {
  rootMeta: TableType
  getMeta: (baseId: string, metaIdOrTitle: string) => Promise<TableType | null>
}) => {
  const result: ColumnTypeForFilter[] = []
  for (const column of rootMeta.columns!) {
    if (column.uidt !== UITypes.Lookup) {
      result.push({ ...column, filterUidt: getFilterUidt(column) })
      continue
    }

    let nextCol: ColumnType | undefined = column
    // check all the relation of nested lookup columns is bt or not
    // include the column only if all only if all relations are bt
    while (nextCol && nextCol.uidt === UITypes.Lookup) {
      // extract the relation column meta
      const lookupRelation: ColumnType | undefined = (await getMeta(rootMeta.base_id!, nextCol.fk_model_id!))?.columns?.find(
        (c) => c.id === (nextCol!.colOptions as LookupType).fk_relation_column_id,
      )
      // this is less likely to happen but if relation column is not found then break the loop
      if (!lookupRelation) {
        break
      }

      const relatedTableMeta: TableType | null = await getMeta(
        rootMeta.base_id!,
        (lookupRelation?.colOptions as LinkToAnotherRecordType).fk_related_model_id!,
      )
      nextCol = relatedTableMeta?.columns?.find((c) => c.id === (nextCol!.colOptions as LookupType).fk_lookup_column_id)

      // if next column is same as root lookup column then break the loop
      // since it's going to be a circular loop
      if (nextCol?.id === column.id) {
        break
      }
    }
    const columnTypeForFilter: ColumnTypeForFilter = {
      ...column,
      btLookupColumn: nextCol,
    }
    columnTypeForFilter.filterUidt = getFilterUidt(columnTypeForFilter)
    result.push(columnTypeForFilter)
  }
  return result
}

export const adjustFilterWhenColumnChange = ({
  filter,
  column,
  showNullAndEmptyInFilter,
}: {
  filter: ColumnFilterType
  column: ColumnTypeForFilter
  showNullAndEmptyInFilter?: boolean
}) => {
  if (!column) return

  const evalUidt: UITypes = column.filterUidt ?? column.uidt
  if (isVirtualCol(column)) {
    filter.dynamic = false
    filter.fk_value_col_id = null
  } else {
    filter.fk_value_col_id = null
  }
  filter.comparison_op = comparisonOpList(evalUidt, parseProp(column.meta)?.date_format).find((compOp) =>
    isComparisonOpAllowed(filter, compOp, evalUidt as UITypes, showNullAndEmptyInFilter),
  )?.value

  if (isDateType(evalUidt) && !['blank', 'notblank'].includes(filter.comparison_op!)) {
    if (filter.comparison_op === 'isWithin') {
      filter.comparison_sub_op = 'pastNumberOfDays'
    } else {
      filter.comparison_sub_op = 'exactDate'
    }

    // Initialize filter.meta if it doesn't exist
    if (!filter.meta) {
      filter.meta = {}
    }
    if (!filter.meta.timezone) {
      filter.meta.timezone = getTimezoneFromColumn(column)
    }
  } else {
    // reset
    filter.comparison_sub_op = null
  }
}

export function getTimezoneFromColumn(col: ColumnType, defaultValue = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const columnMeta = parseProp(col.meta)
  return columnMeta.timezone || defaultValue
}
