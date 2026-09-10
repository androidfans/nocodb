import {
  type ColumnType,
  type LinkToAnotherRecordType,
  RelationTypes,
  UITypes,
  isBtLikeV2Junction,
  isSystemColumn,
} from 'nocodb-sdk'
const unsupportedUITypes = [UITypes.Button]

export const getValidLookupColumn = ({ lookupColumnId, column }: { lookupColumnId?: string; column: ColumnType }) => {
  return (
    (!lookupColumnId || column.id !== lookupColumnId) &&
    !isSystemColumn(column) &&
    !unsupportedUITypes.includes(column.uidt as UITypes)
  )
}

export const getValidLookupColumns = ({ lookupColumnId, columns }: { lookupColumnId?: string; columns: ColumnType[] }) => {
  return columns.map((column) =>
    getValidLookupColumn({
      lookupColumnId,
      column,
    }),
  )
}

export function isSingleBtLongTextLookup(
  relationColumn: ColumnType | undefined,
  lookupColumn: ColumnType | undefined,
  values: unknown[],
) {
  const relationType = (relationColumn?.colOptions as LinkToAnotherRecordType | undefined)?.type
  // A many-target relation with one current result still needs the normal
  // Lookup list interaction; only a direct BT Long Text has no choice to make.
  return (
    lookupColumn?.uidt === UITypes.LongText &&
    values.length === 1 &&
    typeof values[0] === 'string' &&
    values[0].length > 0 &&
    (relationType === RelationTypes.BELONGS_TO ||
      (!!relationColumn && isBtLikeV2Junction(relationColumn) && relationType === RelationTypes.MANY_TO_ONE))
  )
}
