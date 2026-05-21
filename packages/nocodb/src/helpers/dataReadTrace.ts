export interface DataReadTraceStage {
  name: string;
  ms: number;
  meta?: Record<string, unknown>;
}

export interface DataReadTrace {
  id: string;
  enabled: boolean;
  thresholdMs: number;
  startedAtMs: number;
  context: Record<string, unknown>;
  stages: DataReadTraceStage[];
}

export interface DataReadTraceResolverContext {
  trace: DataReadTrace;
  fieldKey: string;
  path: string[];
  isAlias?: boolean;
  aliasPath?: string[];
}

const DATA_READ_TRACE_ARGS_KEY = Symbol.for('nocodb.dataReadTrace.args');

const nowMs = () => Number(process.hrtime.bigint()) / 1_000_000;

const roundMs = (ms: number) => Math.round(ms * 100) / 100;

const getTraceThresholdMs = () => {
  const threshold = Number(process.env.NC_EXPANDED_FORM_TRACE_THRESHOLD_MS);

  return Number.isFinite(threshold) ? threshold : 1000;
};

export const createDataReadTrace = (
  context: Record<string, unknown>,
  options: {
    enabled: boolean;
    thresholdMs?: number;
  },
): DataReadTrace => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  enabled: options.enabled,
  thresholdMs: options.thresholdMs ?? getTraceThresholdMs(),
  startedAtMs: nowMs(),
  context,
  stages: [],
});

export const startDataReadTraceStage = (trace: DataReadTrace | undefined) =>
  trace?.enabled ? nowMs() : 0;

export const getDataReadTraceElapsedMs = (startedAtMs: number) =>
  startedAtMs ? roundMs(nowMs() - startedAtMs) : 0;

export const getDataReadTraceDurationMs = (
  startedAtMs: number,
  endedAtMs: number,
) => (startedAtMs && endedAtMs ? roundMs(endedAtMs - startedAtMs) : 0);

export const finishDataReadTraceStage = (
  trace: DataReadTrace | undefined,
  name: string,
  startedAtMs: number,
  meta?: Record<string, unknown>,
) => {
  if (!trace?.enabled) return;

  trace.stages.push({
    name,
    ms: getDataReadTraceElapsedMs(startedAtMs),
    ...(meta ? { meta } : {}),
  });
};

export const attachDataReadTraceContext = <T>(
  args: T,
  context: DataReadTraceResolverContext | undefined,
): T => {
  if (!context?.trace?.enabled) return args;

  const nextArgs = args && typeof args === 'object' ? { ...(args as any) } : {};

  Object.defineProperty(nextArgs, DATA_READ_TRACE_ARGS_KEY, {
    value: context,
    enumerable: false,
    configurable: true,
  });

  return nextArgs as T;
};

export const getDataReadTraceContext = (
  args: unknown,
): DataReadTraceResolverContext | undefined =>
  args && typeof args === 'object'
    ? (args as any)[DATA_READ_TRACE_ARGS_KEY]
    : undefined;

export const shouldLogDataReadTrace = (trace: DataReadTrace) => {
  if (!trace.enabled) return false;

  return nowMs() - trace.startedAtMs >= trace.thresholdMs;
};

export const logDataReadTrace = (
  logger: { warn: (message: string) => void },
  trace: DataReadTrace,
  extra?: Record<string, unknown>,
) => {
  if (!shouldLogDataReadTrace(trace)) return;

  logger.warn(
    `[nc-trace][expanded-form-read] ${JSON.stringify({
      id: trace.id,
      totalMs: getDataReadTraceElapsedMs(trace.startedAtMs),
      thresholdMs: trace.thresholdMs,
      ...trace.context,
      ...extra,
      stages: trace.stages,
    })}`,
  );
};
