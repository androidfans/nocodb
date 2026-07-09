/** AST node: keys map to nested AST nodes (object) or leaf markers (1 / true) */
import { UITypes } from 'nocodb-sdk';
import type {
  DataReadTrace,
  DataReadTraceResolverContext,
} from '~/helpers/dataReadTrace';
import {
  attachDataReadTraceContext,
  finishDataReadTraceStage,
  startDataReadTraceStage,
} from '~/helpers/dataReadTrace';

interface FieldRequest {
  [key: string]: FieldRequest | 1 | true;
}

/** Recursively flatten nested arrays into a single-level array */
const deepFlatten = (value) => {
  return Array.isArray(value)
    ? value.flatMap((item) => deepFlatten(item))
    : value;
};

type ColumnAlias = {
  path: string[];
  targetUidt?: UITypes | string;
};

const parseMultiSelectLookupValue = (value: any): any => {
  if (value === null || value === undefined || value === '') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const parsed = parseMultiSelectLookupValue(item);
      return Array.isArray(parsed) ? parsed : [parsed];
    });
  }

  if (typeof value !== 'string') {
    return value;
  }

  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      return parseMultiSelectLookupValue(JSON.parse(trimmed));
    } catch {
      // Fall through to comma splitting.
    }
  }

  return value.split(',');
};

const applyColumnAliasTransform = (columnAlias: ColumnAlias, value: any) => {
  const flattened = Array.isArray(value) ? deepFlatten(value) : value;

  if (columnAlias?.targetUidt === UITypes.MultiSelect) {
    return parseMultiSelectLookupValue(flattened);
  }

  return flattened;
};

export type ResolverObj =
  | {
      __proto__?: { __columnAliases?: { [key: string]: ColumnAlias } };
    } & {
      [key: string]: null | ((args: any) => any) | any;
    };

interface NocoExecuteOptions {
  trace?: DataReadTrace;
  tracePath?: string[];
}

/**
 * Recursive resolver that walks a request AST against a proto-decorated
 * data record and resolves all requested fields/relations.
 *
 * Key design: all field resolutions fire synchronously in the same microtick
 * before any `await`. This lets DataLoader collect every `.load()` call into a
 * single batch per relation, reducing N×R queries to R queries.
 * Actual DB execution is serialized via PQueue (see BaseModelSqlv2._queryQueue).
 *
 * @param requestAST   AST describing which fields/nested relations to resolve
 * @param resolverObj  proto-decorated data record (or array of records)
 * @param cache        memoization tree — caches resolved values across lookups
 * @param rootArgs     pagination/filter args passed down for nested resolution
 */
const nocoExecute = async (
  requestAST: FieldRequest,
  resolverObj?: ResolverObj | ResolverObj[],
  cache = {},
  rootArgs = null,
  options: NocoExecuteOptions = {},
): Promise<any> => {
  const trace = options.trace;
  const tracePath = options.tracePath ?? [];

  // Array of records: resolve all in parallel so every record's DataLoader
  // .load() calls land in the same microtick → optimal batching
  if (Array.isArray(resolverObj)) {
    return Promise.all(
      resolverObj.map((record, i) =>
        nocoExecute(
          requestAST,
          record,
          (cache[i] = cache[i] || {}),
          rootArgs,
          options,
        ),
      ),
    );
  }

  // After the array early-return above, resolverObj is always a single record
  const record = resolverObj as ResolverObj;
  const columnAliases = record?.__proto__?.__columnAliases;

  /**
   * Walk a path (e.g. ['Country', 'CountryName']) through the cache,
   * resolving each segment via proto functions or column aliases.
   * Returns a .then() chain (not async) so the promise is created synchronously —
   * this is critical for DataLoader batching.
   */
  const resolvePath = (
    path: string[],
    cacheNode: any,
    sourceObj: any = {},
    args: any = {},
    traceContext?: DataReadTraceResolverContext,
  ): any => {
    if (!path.length) {
      return Promise.resolve(cacheNode);
    }

    const key = path[0];
    const remainingPath = path.slice(1);

    // Resolve the current key if not already cached
    if (cacheNode[key] === undefined || cacheNode[key] === null) {
      if (typeof sourceObj[key] === 'function') {
        cacheNode[key] = sourceObj[key](
          attachDataReadTraceContext(args, traceContext),
        );
      } else if (typeof sourceObj[key] === 'object') {
        cacheNode[key] = Promise.resolve(sourceObj[key]);
      } else if (cacheNode?.__proto__?.__columnAliases?.[key]) {
        // Redirect through column alias (e.g. Lookup → relation path)
        const columnAlias = cacheNode.__proto__.__columnAliases[key];
        cacheNode[key] = resolvePath(
          columnAlias.path,
          cacheNode,
          {},
          args,
          traceContext,
        ).then((resolved) => applyColumnAliasTransform(columnAlias, resolved));
      } else if (typeof cacheNode === 'object') {
        cacheNode[key] = Promise.resolve(sourceObj[key]);
      }
    } else if (typeof cacheNode[key] === 'function') {
      // Move function result to proto to avoid re-invocation
      cacheNode.__proto__ = {
        ...cacheNode.__proto__,
        [key]: cacheNode[key](args),
      };
    }

    // Await the current segment, then recurse into remaining path
    return Promise.resolve(cacheNode[key]).then((resolved) => {
      if (Array.isArray(resolved)) {
        return Promise.all(
          resolved.map((item) =>
            resolvePath(remainingPath, item, {}, args, traceContext),
          ),
        );
      }
      return resolved != null
        ? resolvePath(remainingPath, resolved, {}, args, traceContext)
        : Promise.resolve(null);
    });
  };

  /**
   * Fire a single field's resolver (or column-alias lookup) and store the
   * resulting promise in fieldPromises[key]. Must be synchronous (no await)
   * so that all DataLoader .load() calls happen in the same microtick.
   */
  const fieldPromises: Record<string, any> = {};

  function resolveField(
    key: string,
    args: any,
    traceContext?: DataReadTraceResolverContext,
  ) {
    if (!columnAliases?.[key]) {
      // Direct field: invoke proto function or wrap static value
      if (record) {
        if (typeof record[key] === 'function') {
          fieldPromises[key] = record[key](
            attachDataReadTraceContext(args, traceContext),
          );
        } else if (typeof record[key] === 'object') {
          fieldPromises[key] = Promise.resolve(record[key]);
        } else {
          fieldPromises[key] = Promise.resolve(record[key]);
        }
      }
      cache[key] = fieldPromises[key];
    } else {
      // Column alias (e.g. Lookup): walk the alias path through cache so
      // previously resolved relations (e.g. BT 'Country') are reused
      const columnAlias = columnAliases[key];
      fieldPromises[key] = resolvePath(
        columnAlias.path,
        cache,
        record,
        args?.nested?.[key],
        traceContext,
      ).then((resolved) => applyColumnAliasTransform(columnAlias, resolved));
    }
  }

  // Build nested args for recursive nocoExecute calls
  function buildNestedArgs(key: string) {
    return Object.assign(
      {
        nestedPage: rootArgs?.nestedPage,
        limit: rootArgs?.nestedLimit,
      },
      rootArgs?.nested?.[key] || {},
    );
  }

  // Determine which keys to resolve
  const requestedKeys =
    requestAST && typeof requestAST === 'object'
      ? Object.keys(requestAST).filter((k) => requestAST[k])
      : Object.keys(record);

  const output: any = {};
  const pendingPromises = [];
  const shouldTraceRootFields = !!trace?.enabled && tracePath.length === 0;

  // Phase 1: Fire all resolveField() calls synchronously. This is where
  // DataLoader .load() calls are enqueued — doing them all before any await
  // ensures they land in a single batch per relation type.
  for (const key of requestedKeys) {
    const aliasPath = columnAliases?.[key]?.path;
    const fieldTraceContext = trace?.enabled
      ? {
          trace,
          fieldKey: key,
          path: [...tracePath, key],
          isAlias: !!aliasPath,
          aliasPath,
        }
      : undefined;
    const fieldStartedAt = shouldTraceRootFields
      ? startDataReadTraceStage(trace)
      : 0;

    resolveField(key, rootArgs?.nested?.[key], fieldTraceContext);

    // Phase 2 (chained): For nested AST nodes, chain recursive nocoExecute
    // onto the resolved value. Promise.resolve() safely wraps non-Promise values.
    if (
      requestAST[key] &&
      typeof requestAST[key] === 'object' &&
      fieldPromises[key]
    ) {
      fieldPromises[key] = Promise.resolve(fieldPromises[key]).then(
        (resolved) => {
          if (Array.isArray(resolved)) {
            return (cache[key] = Promise.all(
              resolved.map((item, i) =>
                nocoExecute(
                  requestAST[key] as FieldRequest,
                  item,
                  cache?.[key]?.[i],
                  buildNestedArgs(key),
                  {
                    trace,
                    tracePath: [...tracePath, key],
                  },
                ),
              ),
            ));
          } else if (resolved) {
            return (cache[key] = nocoExecute(
              requestAST[key] as FieldRequest,
              resolved,
              cache[key],
              buildNestedArgs(key),
              {
                trace,
                tracePath: [...tracePath, key],
              },
            ));
          }
          return resolved;
        },
      );
    }

    // Collect all promises — awaited together at the end via Promise.all
    if (fieldPromises[key]) {
      pendingPromises.push(
        (async () => {
          let value;
          try {
            value = await fieldPromises[key];
            output[key] = value;
          } finally {
            if (shouldTraceRootFields) {
              finishDataReadTraceStage(
                trace,
                'nocoExecute.field',
                fieldStartedAt,
                {
                  key,
                  isAlias: !!aliasPath,
                  ...(aliasPath ? { aliasPath } : {}),
                  hasNestedAst:
                    !!requestAST[key] && typeof requestAST[key] === 'object',
                  resultType: Array.isArray(value) ? 'array' : typeof value,
                  ...(Array.isArray(value)
                    ? { resultCount: value.length }
                    : {}),
                },
              );
            }
          }
        })(),
      );
    }
  }

  await Promise.all(pendingPromises);

  return output;
};

export { nocoExecute };
