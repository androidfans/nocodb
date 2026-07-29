import type { Knex } from 'knex';
import { MetaTable } from '~/utils/globals';

const addBooleanColumn = async (
  knex: Knex,
  tableName: string,
  columnName: string,
) => {
  if (await knex.schema.hasColumn(tableName, columnName)) return;

  await knex.schema.alterTable(tableName, (table) => {
    table.boolean(columnName).notNullable().defaultTo(true);
  });
};

const dropColumn = async (
  knex: Knex,
  tableName: string,
  columnName: string,
) => {
  if (!(await knex.schema.hasColumn(tableName, columnName))) return;

  await knex.schema.alterTable(tableName, (table) => {
    table.dropColumn(columnName);
  });
};

const up = async (knex: Knex) => {
  await addBooleanColumn(knex, MetaTable.SORT, 'enabled');
  await addBooleanColumn(knex, MetaTable.GRID_VIEW_COLUMNS, 'group_by_enabled');
  await addBooleanColumn(
    knex,
    MetaTable.TIMELINE_VIEW_COLUMNS,
    'group_by_enabled',
  );
};

const down = async (knex: Knex) => {
  await dropColumn(knex, MetaTable.TIMELINE_VIEW_COLUMNS, 'group_by_enabled');
  await dropColumn(knex, MetaTable.GRID_VIEW_COLUMNS, 'group_by_enabled');
  await dropColumn(knex, MetaTable.SORT, 'enabled');
};

export { up, down };
