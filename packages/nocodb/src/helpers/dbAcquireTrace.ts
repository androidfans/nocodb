import { Logger } from '@nestjs/common';
import type { Knex } from '~/db/CustomKnex';

const logger = new Logger('DbAcquireTrace');

const nowMs = () => Number(process.hrtime.bigint()) / 1_000_000;

const roundMs = (ms: number) => Math.round(ms * 100) / 100;

const getTraceThresholdMs = () => {
  const threshold = Number(process.env.NC_DB_ACQUIRE_TRACE_THRESHOLD_MS);

  return Number.isFinite(threshold) ? threshold : 200;
};

const getPoolSnapshot = (pool: any) => ({
  used: typeof pool.numUsed === 'function' ? pool.numUsed() : undefined,
  free: typeof pool.numFree === 'function' ? pool.numFree() : undefined,
  pendingAcquires:
    typeof pool.numPendingAcquires === 'function'
      ? pool.numPendingAcquires()
      : undefined,
  pendingCreates:
    typeof pool.numPendingCreates === 'function'
      ? pool.numPendingCreates()
      : undefined,
  max: pool.max,
  min: pool.min,
});

const getDbLabel = (arg: string | Knex.Config<any> | any, extDb?: any) => ({
  client:
    typeof arg === 'string'
      ? arg.match(/^(\w+):/)?.[1]
      : typeof arg?.client === 'string'
      ? arg.client
      : arg?.client?.prototype?.dialect || arg?.client?.prototype?.driverName,
  sourceId: extDb?.sourceId,
  dbMux: extDb?.dbMux,
  upgrader: extDb?.upgrader,
});

export const installDbAcquireTrace = (
  kn: Knex,
  arg: string | Knex.Config<any> | any,
  extDb?: any,
) => {
  const pool = (kn as any).client?.pool;

  if (!pool?.on || pool.__ncAcquireTraceInstalled) return;

  pool.__ncAcquireTraceInstalled = true;

  const thresholdMs = getTraceThresholdMs();
  const pending = new Map<number, number>();
  const db = getDbLabel(arg, extDb);

  pool.on('acquireRequest', (eventId: number) => {
    pending.set(eventId, nowMs());
  });

  pool.on('acquireSuccess', (eventId: number) => {
    const startedAtMs = pending.get(eventId);
    pending.delete(eventId);

    if (!startedAtMs) return;

    const waitMs = roundMs(nowMs() - startedAtMs);

    if (waitMs < thresholdMs) return;

    logger.warn(
      `[nc-trace][db-acquire] ${JSON.stringify({
        waitMs,
        thresholdMs,
        db,
        pool: getPoolSnapshot(pool),
      })}`,
    );
  });

  pool.on('acquireFail', (eventId: number, error: Error) => {
    const startedAtMs = pending.get(eventId);
    pending.delete(eventId);

    logger.warn(
      `[nc-trace][db-acquire-fail] ${JSON.stringify({
        waitMs: startedAtMs ? roundMs(nowMs() - startedAtMs) : undefined,
        db,
        pool: getPoolSnapshot(pool),
        error: error?.message,
      })}`,
    );
  });
};
