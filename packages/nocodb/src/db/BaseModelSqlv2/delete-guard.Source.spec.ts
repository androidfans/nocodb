jest.mock('~/models', () => ({
  Model: {
    getBaseModelSQL: jest.fn(),
  },
}));

import knex from 'knex';
import {
  RecordDeleteProtectionMetaProp,
  RelationTypes,
  UITypes,
} from 'nocodb-sdk';
import { DeleteGuard } from './delete-guard';
import { Model } from '~/models';

const protectedRecordIdAlias = '__nc_protected_record_id';

function makeColumn({
  type = RelationTypes.MANY_TO_MANY,
  version = 2,
  meta = {},
}: {
  type?: string;
  version?: number;
  meta?: Record<string, unknown>;
} = {}) {
  const junctionTable = { table_name: 'junction_table' };
  const childTable = { table_name: 'child_table' };
  const childColumn = {
    column_name: 'parent_id',
    getModel: jest.fn().mockResolvedValue(childTable),
  };
  const colOptions = {
    type,
    version,
    getParentChildContext: jest.fn().mockResolvedValue({
      mmContext: { base_id: 'base' },
      childContext: { base_id: 'base' },
    }),
    getMMChildColumn: jest
      .fn()
      .mockResolvedValue({ column_name: 'current_id' }),
    getMMModel: jest.fn().mockResolvedValue(junctionTable),
    getChildColumn: jest.fn().mockResolvedValue(childColumn),
  };

  return {
    uidt: UITypes.LinkToAnotherRecord,
    title: 'Children',
    meta: {
      [RecordDeleteProtectionMetaProp]: true,
      ...meta,
    },
    colOptions: { type, version },
    getColOptions: jest.fn().mockResolvedValue(colOptions),
  } as any;
}

function makeBaseModel(columns: any[], response?: Record<string, unknown>) {
  const db = knex({ client: 'pg' });
  const execAndParse = jest.fn().mockResolvedValue(response);
  const primaryKey = {
    id: 'pk_id',
    title: 'Id',
    column_name: 'id',
  };

  return {
    context: { base_id: 'base' },
    model: {
      primaryKey,
      primaryKeys: [primaryKey],
      getColumns: jest.fn().mockResolvedValue(columns),
    },
    tnPath: 'current_table',
    dbDriver: db,
    getSource: jest.fn().mockResolvedValue({ isMeta: () => true }),
    execAndParse,
  } as any;
}

describe('DeleteGuard', () => {
  beforeEach(() => {
    jest.spyOn(Model, 'getBaseModelSQL').mockImplementation(
      async (_context, { model }) =>
        ({
          getTnPath: () => model.table_name,
        } as any),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each([
    RelationTypes.MANY_TO_MANY,
    RelationTypes.ONE_TO_MANY,
    RelationTypes.MANY_TO_ONE,
    RelationTypes.ONE_TO_ONE,
  ])('checks V2 %s relations in junction storage', async (type) => {
    const column = makeColumn({ type });
    const baseModel = makeBaseModel([column]);

    await new DeleteGuard(baseModel).assertAllowed({ ids: [7, 8] });

    const query = baseModel.execAndParse.mock.calls[0][0].toSQL();
    expect(query.sql).toContain('from "junction_table"');
    expect(query.sql).toContain('"current_id" in (?, ?)');
    expect(query.bindings).toEqual([7, 8, 1]);
  });

  it('checks V1 has-many relations through the child foreign key', async () => {
    const column = makeColumn({ type: 'hm', version: 1 });
    const baseModel = makeBaseModel([column]);

    await new DeleteGuard(baseModel).assertAllowed({ ids: [7] });

    const query = baseModel.execAndParse.mock.calls[0][0].toSQL();
    expect(query.sql).toContain('from "child_table"');
    expect(query.sql).toContain('"parent_id" in (?)');
  });

  it('checks V1 belongs-to relations through the current record foreign key', async () => {
    const column = makeColumn({ type: 'bt', version: 1 });
    const baseModel = makeBaseModel([column]);

    await new DeleteGuard(baseModel).assertAllowed({ ids: [7] });

    const query = baseModel.execAndParse.mock.calls[0][0].toSQL();
    expect(query.sql).toContain('from "current_table"');
    expect(query.sql).toContain('"parent_id" is not null');
    expect(query.sql).toContain('"id" in (?)');
  });

  it('normalizes record snapshots to primary key values', async () => {
    const column = makeColumn();
    const baseModel = makeBaseModel([column]);

    await new DeleteGuard(baseModel).assertAllowed({
      ids: [{ Id: 7 }, { id: 8 }],
    });

    const query = baseModel.execAndParse.mock.calls[0][0].toSQL();
    expect(query.bindings).toEqual([7, 8, 1]);
  });

  it('returns the first conflicting record and stops checking', async () => {
    const columns = [makeColumn(), makeColumn()];
    const baseModel = makeBaseModel(columns, {
      [protectedRecordIdAlias]: 42,
    });

    await expect(
      new DeleteGuard(baseModel).assertAllowed({ ids: [42, 43] }),
    ).rejects.toThrow(
      'Cannot delete record 42: link field "Children" is not empty',
    );
    expect(baseModel.execAndParse).toHaveBeenCalledTimes(1);
  });

  it('uses the complete filtered target query for bulk-delete-all checks', async () => {
    const column = makeColumn();
    const baseModel = makeBaseModel([column]);
    const targetQuery = baseModel
      .dbDriver('current_table')
      .where('status', 'active');

    await new DeleteGuard(baseModel).assertAllowed({ query: targetQuery });

    const query = baseModel.execAndParse.mock.calls[0][0].toSQL();
    expect(query.sql).toContain(
      '"current_id" in (select "id" from "current_table" where "status" = ?)',
    );
    expect(query.bindings).toEqual(['active', 1]);
  });

  it('skips external sources and custom relations', async () => {
    const customColumn = makeColumn({ meta: { custom: true } });
    const externalBaseModel = makeBaseModel([makeColumn()]);
    externalBaseModel.getSource.mockResolvedValue({ isMeta: () => false });
    const customBaseModel = makeBaseModel([customColumn]);

    await new DeleteGuard(externalBaseModel).assertAllowed({ ids: [7] });
    await new DeleteGuard(customBaseModel).assertAllowed({ ids: [7] });

    expect(externalBaseModel.execAndParse).not.toHaveBeenCalled();
    expect(customBaseModel.execAndParse).not.toHaveBeenCalled();
  });
});
