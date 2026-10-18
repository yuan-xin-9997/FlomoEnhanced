/**
 * 登录限流（SPEC §8.1）—— 签名由基础脚手架冻结，实现归 A1。
 * 口径：同一 IP 或同一 username 15 分钟内失败 ≥10 次 → 429。
 *
 * 实现：纯内存滑动窗口（Map<key, 失败时间戳数组>）。
 * - 每个 key 只在自己的 bucket 被访问时清理过期时间戳（惰性清理）；
 * - 额外提供容量上限：key 数量超过 `maxKeys` 时按插入顺序淘汰最旧的 key，
 *   避免长期运行（攻击者轮换 IP/用户名）导致内存无上限增长；
 * - `now` 可注入，便于测试与时钟控制。
 */

/** 限流器接口 */
export interface RateLimiter {
  /** 当前是否允许该 key 继续尝试 */
  allow(key: string): boolean;
  /** 记录一次失败 */
  recordFailure(key: string): void;
  /** 清空该 key 的失败记录 */
  reset(key: string): void;
}

/** 默认 key 容量上限（超出后淘汰最久未新增的 key） */
const DEFAULT_MAX_KEYS = 10_000;

export interface RateLimiterOptions {
  windowMs: number;
  maxFailures: number;
  now?: () => number;
  /** 内存中的 key 上限，默认 10000 */
  maxKeys?: number;
}

/** 创建内存限流器 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const windowMs = Math.max(1, Math.floor(options.windowMs));
  const maxFailures = Math.max(1, Math.floor(options.maxFailures));
  const maxKeys = Math.max(1, Math.floor(options.maxKeys ?? DEFAULT_MAX_KEYS));
  const now: () => number = options.now ?? Date.now;

  /** key → 失败时间戳（毫秒，升序） */
  const buckets = new Map<string, number[]>();

  /** 惰性清理：丢掉窗口之外的时间戳 */
  function prune(bucket: number[], nowMs: number): void {
    const threshold = nowMs - windowMs;
    let drop = 0;
    while (drop < bucket.length && (bucket[drop] as number) <= threshold) drop += 1;
    if (drop > 0) bucket.splice(0, drop);
  }

  /** 容量控制：淘汰最旧的 key（Map 保持插入顺序） */
  function enforceCapacity(): void {
    while (buckets.size > maxKeys) {
      const oldest = buckets.keys().next();
      if (oldest.done === true) return;
      buckets.delete(oldest.value);
    }
  }

  /** 取出有效的（未过期）失败记录，同时清掉空 bucket */
  function activeBucket(key: string): number[] | undefined {
    const bucket = buckets.get(key);
    if (bucket === undefined) return undefined;
    prune(bucket, now());
    if (bucket.length === 0) {
      buckets.delete(key);
      return undefined;
    }
    return bucket;
  }

  return {
    allow(key: string): boolean {
      const bucket = activeBucket(key);
      if (bucket === undefined) return true;
      return bucket.length < maxFailures;
    },

    recordFailure(key: string): void {
      const nowMs = now();
      const bucket = buckets.get(key);
      if (bucket === undefined) {
        buckets.set(key, [nowMs]);
        enforceCapacity();
        return;
      }
      prune(bucket, nowMs);
      bucket.push(nowMs);
    },

    reset(key: string): void {
      buckets.delete(key);
    },
  };
}
