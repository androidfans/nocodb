import { FormulaDataTypes, parseProp, UITypes } from 'nocodb-sdk';
import { ComputedFieldHandler } from '../computed';
import type { ColumnType, ParsedFormulaNode } from 'nocodb-sdk';
import type CustomKnex from 'src/db/CustomKnex';
import type {
  FilterOptions,
  FilterVerificationResult,
} from '~/db/field-handler/field-handler.interface';
import type { FormulaColumn } from '~/models';
import formulaQueryBuilderv2 from '~/db/formulav2/formulaQueryBuilderv2';
import { Column, Filter } from '~/models';

type GroupByFilter = Filter & { groupby?: boolean };

const DATE_TIME_UIDTS = new Set<string>([
  UITypes.DateTime,
  UITypes.CreatedTime,
  UITypes.LastModifiedTime,
]);

function normalizeArrayGroupValue(value: unknown, referencedUidt?: string) {
  let parsedValue = value;

  if (typeof value === 'string') {
    try {
      parsedValue = JSON.parse(value);
    } catch {
      return value;
    }
  }

  if (!Array.isArray(parsedValue)) return value;

  if (!referencedUidt || !DATE_TIME_UIDTS.has(referencedUidt)) {
    return parsedValue;
  }

  return parsedValue.map((item) => {
    if (typeof item !== 'string') return item;

    const date = new Date(item);
    return Number.isNaN(date.getTime()) ? item : date;
  });
}

export class FormulaGeneralHandler extends ComputedFieldHandler {
  override async filter(
    knex: CustomKnex,
    filter: Filter,
    column: Column,
    options: FilterOptions,
  ) {
    const {
      context,
      conditionParser: parseConditionV2,
      baseModel: baseModelSqlv2,
      alias,
      depth: aliasCount,
    } = options;
    const model = await column.getModel(context);
    const formula = await column.getColOptions<FormulaColumn>(context);
    const builder = (
      await formulaQueryBuilderv2({
        baseModel: baseModelSqlv2,
        tree: formula.formula,
        model,
        column,
        tableAlias: alias,
      })
    ).builder;
    const parsedTree: ParsedFormulaNode = formula.getParsedTree();
    const filterValue =
      parsedTree?.dataType === FormulaDataTypes.ARRAY &&
      (filter as GroupByFilter).groupby
        ? normalizeArrayGroupValue(
            filter.value,
            parsedTree.referencedColumn?.uidt,
          )
        : filter.value;
    const value =
      parsedTree?.dataType === FormulaDataTypes.DATE
        ? filterValue
        : knex.raw('?', [
            // convert value to number if formulaDataType if numeric
            parsedTree?.dataType === FormulaDataTypes.NUMERIC &&
            !isNaN(+filterValue)
              ? +filterValue
              : filterValue ?? null, // in gp_null value is undefined
          ]);
    return parseConditionV2(
      baseModelSqlv2,
      new Filter({
        ...filter,
        value,
      } as any),
      aliasCount,
      alias,
      builder,
    );
  }

  override async verifyFilter(
    filter: Filter,
    column: Column,
    options: FilterOptions = {},
  ) {
    const uidt = parseProp(column.meta).display_type;
    if (uidt) {
      const updatedColumn = new Column({
        ...column,
        uidt: uidt,
      } as ColumnType);
      return options.fieldHandler.verifyFilter(filter, updatedColumn, options);
    } else {
      const formulaCol = await column.getColOptions<FormulaColumn>(
        options.context,
      );
      const parsedTree = await formulaCol.getParsedTree();

      const setColumnTypeAndVerify = (type: UITypes) => {
        const updatedColumn = new Column({
          ...column,
          uidt: type,
        } as ColumnType);
        return options.fieldHandler.verifyFilter(
          filter,
          updatedColumn,
          options,
        );
      };

      if (!parsedTree?.dataType) {
        return setColumnTypeAndVerify(UITypes.SingleLineText);
      }

      const dataType = parsedTree.dataType;

      switch (dataType) {
        case FormulaDataTypes.BOOLEAN:
          return setColumnTypeAndVerify(UITypes.Checkbox);
        case FormulaDataTypes.DATE:
          return setColumnTypeAndVerify(UITypes.DateTime);
        case FormulaDataTypes.INTERVAL:
          return setColumnTypeAndVerify(UITypes.Time);
        case FormulaDataTypes.NUMERIC:
          return setColumnTypeAndVerify(UITypes.Decimal);
        case FormulaDataTypes.STRING:
        default:
          return setColumnTypeAndVerify(UITypes.SingleLineText);
      }
    }

    return {
      isValid: true,
    } as FilterVerificationResult;
  }
}
