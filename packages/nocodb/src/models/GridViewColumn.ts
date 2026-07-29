import {
  type BoolType,
  type GridColumnType,
  VIEW_GRID_DEFAULT_WIDTH,
} from 'nocodb-sdk';
import type { NcContext } from '~/interface/config';
import type Upgrader from '~/Upgrader';
import View from '~/models/View';
import Noco from '~/Noco';
import { extractProps } from '~/helpers/extractProps';
import NocoCache from '~/cache/NocoCache';
import { CacheGetType, CacheScope, MetaTable } from '~/utils/globals';

export default class GridViewColumn implements GridColumnType {
  id: string;
  show: BoolType;
  order: number;
  width?: string;
  label?: string;

  fk_view_id: string;
  fk_column_id: string;
  fk_workspace_id?: string;
  base_id?: string;
  source_id?: string;

  group_by?: BoolType;
  group_by_enabled?: BoolType;
  group_by_order?: number;
  group_by_sort?: string;

  aggregation?: string;

  constructor(data: GridViewColumn) {
    Object.assign(this, data);
  }

  public static async list(
    context: NcContext,
    viewId: string,
    ncMeta = Noco.ncMeta,
  ): Promise<GridViewColumn[]> {
    const cachedList = await NocoCache.getList(
      context,
      CacheScope.GRID_VIEW_COLUMN,
      [viewId],
    );
    let { list: views } = cachedList;
    const { isNoneList } = cachedList;
    if (!isNoneList && !views.length) {
      views = await ncMeta.metaList2(
        context.workspace_id,
        context.base_id,
        MetaTable.GRID_VIEW_COLUMNS,
        {
          condition: {
            fk_view_id: viewId,
          },
          orderBy: {
            order: 'asc',
          },
        },
      );
      await NocoCache.setList(
        context,
        CacheScope.GRID_VIEW_COLUMN,
        [viewId],
        views,
      );
    }
    views.sort(
      (a, b) =>
        (a.order != null ? a.order : Infinity) -
        (b.order != null ? b.order : Infinity),
    );
    const view = await View.get(context, viewId, false, ncMeta);
    return views?.map(
      (v) =>
        new GridViewColumn({
          ...v,
          group_by_enabled: View.isConditionEnabled(
            view,
            'groupBy',
            v.fk_column_id,
          ),
        } as GridViewColumn),
    );
  }

  public static async get(
    context: NcContext,
    gridViewColumnId: string,
    ncMeta = Noco.ncMeta,
  ) {
    let viewColumn =
      gridViewColumnId &&
      (await NocoCache.get(
        context,
        `${CacheScope.GRID_VIEW_COLUMN}:${gridViewColumnId}`,
        CacheGetType.TYPE_OBJECT,
      ));
    if (!viewColumn) {
      viewColumn = await ncMeta.metaGet2(
        context.workspace_id,
        context.base_id,
        MetaTable.GRID_VIEW_COLUMNS,
        gridViewColumnId,
      );
      if (viewColumn) {
        await NocoCache.set(
          context,
          `${CacheScope.GRID_VIEW_COLUMN}:${gridViewColumnId}`,
          viewColumn,
        );
      }
    }
    if (!viewColumn) return null;

    const view = await View.get(context, viewColumn.fk_view_id, false, ncMeta);
    return new GridViewColumn({
      ...viewColumn,
      group_by_enabled: View.isConditionEnabled(
        view,
        'groupBy',
        viewColumn.fk_column_id,
      ),
    } as GridViewColumn);
  }

  static async insert(
    context: NcContext,
    column: Partial<GridViewColumn>,
    ncMeta = Noco.ncMeta,
  ) {
    const insertObj = extractProps(column, [
      'fk_view_id',
      'fk_column_id',
      'show',
      'base_id',
      'source_id',
      'order',
      'label',
      'width',
      'group_by',
      'group_by_order',
      'group_by_sort',
    ]);

    insertObj.order =
      column?.order ??
      (await ncMeta.metaGetNextOrder(MetaTable.GRID_VIEW_COLUMNS, {
        fk_view_id: column.fk_view_id,
      }));

    if (!insertObj.source_id) {
      const viewRef = await View.get(
        context,
        insertObj.fk_view_id,
        false,
        ncMeta,
      );
      insertObj.source_id = viewRef.source_id;
    }

    insertObj.width = column?.width ?? VIEW_GRID_DEFAULT_WIDTH + 'px';

    const { id } = await ncMeta.metaInsert2(
      context.workspace_id,
      context.base_id,
      MetaTable.GRID_VIEW_COLUMNS,
      insertObj,
    );

    if (column.group_by_enabled === false || column.group_by_enabled === 0) {
      await View.setConditionEnabled(
        context,
        column.fk_view_id,
        'groupBy',
        column.fk_column_id,
        false,
        ncMeta,
      );
    }

    if (!(ncMeta as Upgrader).upgrader_mode) {
      // TODO: optimize this function & try to avoid if possible
      await View.fixPVColumnForView(context, column.fk_view_id, ncMeta);
    }

    // on new view column, delete any optimised single query cache
    {
      const view = await View.get(context, column.fk_view_id, false, ncMeta);
      if (view) {
        await View.clearSingleQueryCache(
          context,
          view.fk_model_id,
          [view],
          ncMeta,
        );
      }
    }

    return this.get(context, id, ncMeta).then(async (viewColumn) => {
      await NocoCache.appendToList(
        context,
        CacheScope.GRID_VIEW_COLUMN,
        [column.fk_view_id],
        `${CacheScope.GRID_VIEW_COLUMN}:${id}`,
      );
      return viewColumn;
    });
  }

  static async update(
    context: NcContext,
    columnId: string,
    body: Partial<GridViewColumn>,
    ncMeta = Noco.ncMeta,
  ) {
    const viewColumn = await this.get(context, columnId, ncMeta);
    const updateObj = extractProps(body, [
      'order',
      'show',
      'label',
      'width',
      'group_by',
      'group_by_order',
      'group_by_sort',
      'aggregation',
    ]);

    // set meta
    const res = Object.keys(updateObj).length
      ? await ncMeta.metaUpdate(
          context.workspace_id,
          context.base_id,
          MetaTable.GRID_VIEW_COLUMNS,
          updateObj,
          columnId,
        )
      : true;

    if (Object.keys(updateObj).length) {
      await NocoCache.update(
        context,
        `${CacheScope.GRID_VIEW_COLUMN}:${columnId}`,
        updateObj,
      );
    }

    if ('group_by_enabled' in body) {
      await View.setConditionEnabled(
        context,
        viewColumn.fk_view_id,
        'groupBy',
        viewColumn.fk_column_id,
        body.group_by_enabled !== false && body.group_by_enabled !== 0,
        ncMeta,
      );
    }

    // on view column update, delete any optimised single query cache
    {
      if (viewColumn?.fk_view_id) {
        const view = await View.get(
          context,
          viewColumn.fk_view_id,
          false,
          ncMeta,
        );
        if (view) {
          await View.clearSingleQueryCache(
            context,
            view.fk_model_id,
            [view],
            ncMeta,
          );
        }
      }
    }

    return res;
  }
}
