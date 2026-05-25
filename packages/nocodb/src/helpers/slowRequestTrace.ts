import { Logger } from '@nestjs/common';
import { monitorEventLoopDelay } from 'perf_hooks';
import type { NextFunction, Request, Response } from 'express';

const logger = new Logger('SlowRequestTrace');
const FALLBACK_QUEUE_SNAPSHOT_KEY = Symbol.for(
  'nocodb.trace.fallbackQueueSnapshot',
);

const nowMs = () => Number(process.hrtime.bigint()) / 1_000_000;

const roundMs = (ms: number) => Math.round(ms * 100) / 100;

const getThresholdMs = (name: string, defaultValue: number) => {
  const value = Number(process.env[name]);

  return Number.isFinite(value) ? value : defaultValue;
};

const histogram = monitorEventLoopDelay({ resolution: 20 });
histogram.enable();

let activeRequests = 0;

export const getSlowTraceQueueSnapshot = () => {
  const snapshot = (globalThis as any)[FALLBACK_QUEUE_SNAPSHOT_KEY];

  return typeof snapshot === 'function' ? snapshot() : undefined;
};

export const getSlowTraceRuntimeSnapshot = () => {
  const memory = process.memoryUsage();

  return {
    activeRequests,
    fallbackQueue: getSlowTraceQueueSnapshot(),
    eventLoopDelay: {
      meanMs: roundMs(histogram.mean / 1_000_000),
      maxMs: roundMs(histogram.max / 1_000_000),
      p95Ms: roundMs(histogram.percentile(95) / 1_000_000),
      p99Ms: roundMs(histogram.percentile(99) / 1_000_000),
    },
    memory: {
      rssMb: roundMs(memory.rss / 1024 / 1024),
      heapUsedMb: roundMs(memory.heapUsed / 1024 / 1024),
      heapTotalMb: roundMs(memory.heapTotal / 1024 / 1024),
      externalMb: roundMs(memory.external / 1024 / 1024),
    },
  };
};

const resetEventLoopHistogram = () => {
  histogram.reset();
};

const sanitizeUrl = (req: Request) => {
  const url = req.originalUrl || req.url || '';

  return url
    .replace(
      /([?&](?:password|token|api[_-]?key|xc-token|auth)=[^&]*)/gi,
      '$1***',
    )
    .slice(0, 500);
};

export const installSlowRequestTrace = (app: {
  use: (
    handler: (req: Request, res: Response, next: NextFunction) => void,
  ) => void;
}) => {
  const thresholdMs = getThresholdMs('NC_HTTP_SLOW_TRACE_THRESHOLD_MS', 1000);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAtMs = nowMs();
    activeRequests += 1;

    res.on('finish', () => {
      activeRequests -= 1;

      const totalMs = roundMs(nowMs() - startedAtMs);

      if (totalMs < thresholdMs) return;

      logger.warn(
        `[nc-trace][http-slow] ${JSON.stringify({
          totalMs,
          thresholdMs,
          method: req.method,
          url: sanitizeUrl(req),
          statusCode: res.statusCode,
          contentLength: res.getHeader('content-length'),
          ...getSlowTraceRuntimeSnapshot(),
        })}`,
      );

      resetEventLoopHistogram();
    });

    next();
  });
};

export const installRuntimeSnapshotTrace = () => {
  const intervalMs = getThresholdMs('NC_RUNTIME_TRACE_INTERVAL_MS', 0);

  if (intervalMs <= 0) return;

  setInterval(() => {
    logger.warn(
      `[nc-trace][runtime] ${JSON.stringify({
        intervalMs,
        uptimeSec: roundMs(process.uptime()),
        ...getSlowTraceRuntimeSnapshot(),
      })}`,
    );

    resetEventLoopHistogram();
  }, intervalMs).unref();
};
