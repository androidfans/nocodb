import {
  isLinksOrLTAR,
  isMMOrMMLike,
  parseProp,
  RecordDeleteProtectionMetaProp,
} from 'nocodb-sdk';
import type { Knex } from 'knex';
import type { IBaseModelSqlV2 } from '~/db/IBaseModelSqlV2';
import type { Column, LinkToAnotherRecordColumn } from '~/models';
import { Model } from '~/models';
import { NcError } from '~/helpers/catchError';

const PROTECTED_RECORD_ID_ALIAS = '__nc_protected_record_id';

export type DeleteGuardTarget =
  | { ids: unknown[] }
  | { query: Knex.QueryBuilder };

/**
 * Validates record-delete rules before hooks, audits, or relation cleanup run.
 *
 * The guard queries physical FK / junction storage instead of hydrated virtual
 * fields, since delete snapshots do not consistently include LTAR values.
 */
export class DeleteGuard {
  constructor(private readonly baseModel: IBaseModelSqlV2) {}

  async assertAllowed(target: DeleteGuardTarget): Promise<void> {
    const source = await this.baseModel.getSource();
    if (!source.isMeta()) return;

    const columns = await this.baseModel.model.getColumns(
      this.baseModel.context,
    );
    const protectedColumns = columns.filter((column) => {
      const meta = parseProp(column.meta);
      return (
        isLinksOrLTAR(column) &&
        meta?.[RecordDeleteProtectionMetaProp] === true &&
        !meta?.custom
      );
    });

    if (!protectedColumns.length) return;

    if (this.baseModel.model.primaryKeys.length !== 1) {
      NcError.get(this.baseModel.context).badRequest(
        'Record deletion protection does not support composite primary keys',
      );
    }

    for (const column of protectedColumns) {
      const recordId = await this.findFirstLinkedRecordId(column, target);
      if (recordId === undefined || recordId === null) continue;

      NcError.get(this.baseModel.context).badRequest(
        `Cannot delete record ${recordId}: link field "${column.title}" is not empty. Clear the field before deleting the record.`,
      );
    }
  }

  private applyTarget(
    qb: Knex.QueryBuilder,
    columnName: string,
    target: DeleteGuardTarget,
  ): Knex.QueryBuilder {
    if ('ids' in target) {
      const primaryKey = this.baseModel.model.primaryKey;
      const ids = target.ids.map((id) => {
        if (!id || typeof id !== 'object' || Array.isArray(id)) return id;

        const idObject = id as Record<string, unknown>;

        return (
          idObject[primaryKey.id] ??
          idObject[primaryKey.title] ??
          idObject[primaryKey.column_name]
        );
      });
      return qb.whereIn(columnName, ids);
    }

    const targetIds = target.query
      .clone()
      .clearSelect()
      .clearOrder()
      .select(this.baseModel.model.primaryKey.column_name);
    return qb.whereIn(columnName, targetIds);
  }

  private async findFirstLinkedRecordId(
    column: Column,
    target: DeleteGuardTarget,
  ): Promise<unknown | undefined> {
    // Soft-deleted related rows intentionally remain links: restoring them must
    // not reveal that the protected chain was broken while they were in trash.
    const colOptions = await column.getColOptions<LinkToAnotherRecordColumn>(
      this.baseModel.context,
    );
    const { mmContext, childContext } = await colOptions.getParentChildContext(
      this.baseModel.context,
    );
    const relationType = isMMOrMMLike(column) ? 'mm' : colOptions.type;

    let qb: Knex.QueryBuilder;

    if (relationType === 'mm') {
      const junctionChildColumn = await colOptions.getMMChildColumn(mmContext);
      const junctionTable = await colOptions.getMMModel(mmContext);
      const junctionBaseModel = await Model.getBaseModelSQL(mmContext, {
        model: junctionTable,
        dbDriver: this.baseModel.dbDriver,
      });
      qb = this.baseModel.dbDriver(junctionBaseModel.getTnPath(junctionTable));
      qb.select({
        [PROTECTED_RECORD_ID_ALIAS]: junctionChildColumn.column_name,
      });
      this.applyTarget(qb, junctionChildColumn.column_name, target);
    } else if (
      relationType === 'hm' ||
      (relationType === 'oo' && !column.meta?.bt)
    ) {
      const childColumn = await colOptions.getChildColumn(childContext);
      const childTable = await childColumn.getModel(childContext);
      const childBaseModel = await Model.getBaseModelSQL(childContext, {
        model: childTable,
        dbDriver: this.baseModel.dbDriver,
      });
      qb = this.baseModel.dbDriver(childBaseModel.getTnPath(childTable));
      qb.select({
        [PROTECTED_RECORD_ID_ALIAS]: childColumn.column_name,
      });
      this.applyTarget(qb, childColumn.column_name, target);
    } else {
      const childColumn = await colOptions.getChildColumn(childContext);
      qb = this.baseModel.dbDriver(this.baseModel.tnPath);
      qb.select({
        [PROTECTED_RECORD_ID_ALIAS]:
          this.baseModel.model.primaryKey.column_name,
      }).whereNotNull(childColumn.column_name);
      this.applyTarget(qb, this.baseModel.model.primaryKey.column_name, target);
    }

    // This first version prevents routine accidental deletion only. It does not
    // lock relation storage against a concurrent request adding a new link.
    const row = await this.baseModel.execAndParse(qb.limit(1), null, {
      raw: true,
      first: true,
    });
    return row?.[PROTECTED_RECORD_ID_ALIAS];
  }
}
