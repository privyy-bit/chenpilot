export type ExtendTradeLock = (
  lockKey: string,
  lockToken: string,
  ttlSeconds: number
) => Promise<boolean>;

export interface TradeLockHeartbeatOptions {
  lockKey: string;
  lockToken: string;
  hopCount: number;
  extendLock: ExtendTradeLock;
  onLockLost: (error: Error) => void;
  baseTtlSeconds?: number;
  ttlPerAdditionalHopSeconds?: number;
  heartbeatIntervalSeconds?: number;
}

export interface TradeLockHeartbeat {
  ttlSeconds: number;
  stop: () => void;
}

/**
 * Keeps a trade lock alive while a long-running swap is executing.
 *
 * The TTL grows with the number of hops. The heartbeat defaults to one-third
 * of the resulting TTL, ensuring that an extension is attempted well before
 * the lock can expire.
 */
export function startTradeLockHeartbeat(
  options: TradeLockHeartbeatOptions
): TradeLockHeartbeat {
  const baseTtlSeconds = options.baseTtlSeconds ?? 60;
  const ttlPerAdditionalHopSeconds =
    options.ttlPerAdditionalHopSeconds ?? 60;
  const hopCount = Math.max(1, Math.floor(options.hopCount));
  const ttlSeconds =
    baseTtlSeconds + (hopCount - 1) * ttlPerAdditionalHopSeconds;
  const heartbeatIntervalSeconds =
    options.heartbeatIntervalSeconds ?? Math.max(1, Math.floor(ttlSeconds / 3));

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const reportLockLoss = (error: Error): void => {
    if (stopped) {
      return;
    }

    stopped = true;
    if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
    options.onLockLost(error);
  };

  const extend = async (): Promise<void> => {
    if (stopped) {
      return;
    }

    try {
      const extended = await options.extendLock(
        options.lockKey,
        options.lockToken,
        ttlSeconds
      );

      if (!extended) {
        reportLockLoss(
          new Error(`Trade lock ${options.lockKey} could not be extended`)
        );
      }
    } catch (error) {
      reportLockLoss(
        error instanceof Error
          ? error
          : new Error(`Trade lock ${options.lockKey} could not be extended`)
      );
    }
  };

  timer = setInterval(() => {
    void extend();
  }, heartbeatIntervalSeconds * 1000);

  return {
    ttlSeconds,
    stop: (): void => {
      if (stopped) {
        return;
      }

      stopped = true;
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
