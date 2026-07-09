import { UITypes } from 'nocodb-sdk';
import { nocoExecute, type ResolverObj } from './nocoExecute';

const withColumnAliases = (
  data: Record<string, any>,
  aliases: NonNullable<ResolverObj['__proto__']>['__columnAliases'],
) => Object.assign(Object.create({ __columnAliases: aliases }), data);

describe('nocoExecute', () => {
  it('normalizes nested lookup aliases that resolve to a multiselect column', async () => {
    const referencedRecord = {
      category: 'Option A,Option B',
    };
    const intermediateRecord = withColumnAliases(
      {
        reference: referencedRecord,
      },
      {
        nested_lookup: {
          path: ['reference', 'category'],
          targetUidt: UITypes.MultiSelect,
        },
      },
    );
    const row = withColumnAliases(
      {
        relation: intermediateRecord,
      },
      {
        lookup_category: {
          path: ['relation', 'nested_lookup'],
          targetUidt: UITypes.MultiSelect,
        },
      },
    );

    await expect(nocoExecute({ lookup_category: 1 }, row)).resolves.toEqual({
      lookup_category: ['Option A', 'Option B'],
    });
  });

  it('flattens JSON aggregated multiselect lookup values', async () => {
    const row = withColumnAliases(
      {
        references: [
          {
            category: '["Option A,Option B","Option C"]',
          },
        ],
      },
      {
        lookup_category: {
          path: ['references', 'category'],
          targetUidt: UITypes.MultiSelect,
        },
      },
    );

    await expect(nocoExecute({ lookup_category: 1 }, row)).resolves.toEqual({
      lookup_category: ['Option A', 'Option B', 'Option C'],
    });
  });
});
