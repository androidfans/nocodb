import {
  filterBuilder,
  filterRevBuilder,
  sortBuilder,
} from './api-v3-data-transformation.builder';

describe('view condition v3 transformations', () => {
  it('exposes the enabled state for sorts', () => {
    expect(
      sortBuilder().build({
        id: 'sort-1',
        fk_column_id: 'column-1',
        direction: 'asc',
        enabled: 0,
      })
    ).toEqual({
      id: 'sort-1',
      field_id: 'column-1',
      direction: 'asc',
      enabled: false,
    });
  });

  it('exposes the enabled state for filters', () => {
    expect(
      filterBuilder().build({
        id: 'filter-1',
        fk_column_id: 'column-1',
        comparison_op: 'eq',
        enabled: 0,
      })
    ).toEqual({
      id: 'filter-1',
      field_id: 'column-1',
      operator: 'eq',
      enabled: false,
    });
  });

  it('accepts enabled updates for filters', () => {
    expect(
      filterRevBuilder().build({
        id: 'filter-1',
        field_id: 'column-1',
        operator: 'eq',
        enabled: false,
      })
    ).toEqual({
      id: 'filter-1',
      fk_column_id: 'column-1',
      comparison_op: 'eq',
      enabled: false,
    });
  });
});
