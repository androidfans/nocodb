jest.mock('~/models', () => ({
  Model: {
    getBaseModelSQL: jest.fn(),
  },
}));
jest.mock('~/helpers/catchError', () => ({ NcError: {} }));
jest.mock('~/helpers/dbHelpers', () => ({}));

import { LTARColsUpdater } from './ltar-cols-updater';
import { getRelatedBaseModelDriver } from './add-remove-links';
import { Model } from '~/models';

describe('BaseModel transaction driver propagation', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('keeps the base driver when propagating an active transaction', () => {
    const dbDriver = {} as any;
    const transaction = {} as any;

    expect(
      getRelatedBaseModelDriver({
        knex: dbDriver,
        dbDriver: transaction,
      }),
    ).toEqual({ dbDriver, transaction });
  });

  it('does not mark the base driver as a transaction', () => {
    const dbDriver = {} as any;

    expect(
      getRelatedBaseModelDriver({
        knex: dbDriver,
        dbDriver,
      }),
    ).toEqual({ dbDriver, transaction: undefined });
  });

  it('builds the V3 LTAR transaction model on the base driver', async () => {
    const transaction = {
      commit: jest.fn(),
      rollback: jest.fn(),
    } as any;
    const activeDriver = {
      transaction: jest.fn().mockResolvedValue(transaction),
    } as any;
    const baseDriver = {} as any;
    const model = { columns: [] } as any;
    const trxBaseModel = {} as any;
    const getBaseModelSQL = jest
      .spyOn(Model, 'getBaseModelSQL')
      .mockResolvedValue(trxBaseModel);

    const updater = LTARColsUpdater({
      baseModel: {
        context: {},
        model,
        dbDriver: activeDriver,
        knex: baseDriver,
      } as any,
      logger: {} as any,
    });

    await updater.updateLTARCols({ datas: [], cookie: {} as any });

    expect(getBaseModelSQL).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        model,
        dbDriver: baseDriver,
        transaction,
      }),
    );
    expect(transaction.commit).toHaveBeenCalledTimes(1);
    expect(transaction.rollback).not.toHaveBeenCalled();
  });
});
