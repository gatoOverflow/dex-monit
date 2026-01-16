import { Injectable, OnModuleInit, OnModuleDestroy, Inject, Logger as NestLogger } from '@nestjs/common';
import Redis from 'ioredis';
import { Logger } from '@dex-monit/observability-logger';

// Check if Redis is enabled
const REDIS_ENABLED = process.env['REDIS_ENABLED'] === 'true' || process.env['ASYNC_INGESTION'] === 'true';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private client: Redis | null = null;
  private subscriber: Redis | null = null;
  private connected = false;
  private readonly nestLogger = new NestLogger('RedisService');

  constructor(@Inject(Logger) private readonly logger: Logger) {}

  async onModuleInit() {
    if (!REDIS_ENABLED) {
      this.nestLogger.warn('Redis disabled (set REDIS_ENABLED=true to enable)');
      return;
    }

    const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';

    try {
      this.client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        retryDelayOnFailover: 100,
        lazyConnect: true,
        connectTimeout: 5000,
        enableOfflineQueue: false,
      });

      this.subscriber = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true,
        connectTimeout: 5000,
      });

      // Set error handlers
      this.client.on('error', (err) => {
        this.nestLogger.warn(`Redis client error: ${err.message}`);
      });

      this.subscriber.on('error', (err) => {
        this.nestLogger.warn(`Redis subscriber error: ${err.message}`);
      });

      await this.client.connect();
      this.connected = true;
      this.logger.info('Redis connected');
    } catch (error) {
      this.nestLogger.warn(`Failed to connect to Redis: ${error instanceof Error ? error.message : error}`);
      this.nestLogger.warn('Continuing without Redis (caching and rate limiting disabled)');
      this.client = null;
      this.subscriber = null;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit().catch(() => {});
    }
    if (this.subscriber) {
      await this.subscriber.quit().catch(() => {});
    }
  }

  isConnected(): boolean {
    return this.connected && this.client !== null;
  }

  isEnabled(): boolean {
    return REDIS_ENABLED;
  }

  getClient(): Redis | null {
    return this.client;
  }

  getSubscriber(): Redis | null {
    return this.subscriber;
  }

  // ============================================
  // CACHING METHODS
  // ============================================

  /**
   * Get cached value
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.client) return null;
    try {
      const value = await this.client.get(key);
      if (!value) return null;
      try {
        return JSON.parse(value) as T;
      } catch {
        return value as unknown as T;
      }
    } catch {
      return null;
    }
  }

  /**
   * Set cached value with TTL (in seconds)
   */
  async set(key: string, value: unknown, ttlSeconds: number = 60): Promise<void> {
    if (!this.client) return;
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      await this.client.setex(key, ttlSeconds, serialized);
    } catch {
      // Ignore Redis errors
    }
  }

  /**
   * Delete cached value
   */
  async del(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(key);
    } catch {
      // Ignore Redis errors
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async delPattern(pattern: string): Promise<void> {
    if (!this.client) return;
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch {
      // Ignore Redis errors
    }
  }

  /**
   * Get or set cached value
   */
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttlSeconds: number = 60,
  ): Promise<T> {
    if (!this.client) {
      return factory();
    }

    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  // ============================================
  // RATE LIMITING
  // ============================================

  /**
   * Check and increment rate limit
   * Returns true if within limit, false if exceeded
   */
  async checkRateLimit(
    key: string,
    limit: number,
    windowSeconds: number,
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    // If Redis is not available, always allow (no rate limiting)
    if (!this.client) {
      return { allowed: true, remaining: limit, resetIn: windowSeconds };
    }

    try {
      const now = Date.now();
      const windowKey = `ratelimit:${key}:${Math.floor(now / (windowSeconds * 1000))}`;

      const count = await this.client.incr(windowKey);
      if (count === 1) {
        await this.client.expire(windowKey, windowSeconds);
      }

      const ttl = await this.client.ttl(windowKey);

      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetIn: ttl > 0 ? ttl : windowSeconds,
      };
    } catch {
      return { allowed: true, remaining: limit, resetIn: windowSeconds };
    }
  }

  // ============================================
  // COUNTERS
  // ============================================

  /**
   * Increment a counter
   */
  async incr(key: string, by: number = 1): Promise<number> {
    if (!this.client) return 0;
    try {
      if (by === 1) {
        return this.client.incr(key);
      }
      return this.client.incrby(key, by);
    } catch {
      return 0;
    }
  }

  /**
   * Get counter value
   */
  async getCounter(key: string): Promise<number> {
    if (!this.client) return 0;
    try {
      const value = await this.client.get(key);
      return value ? parseInt(value, 10) : 0;
    } catch {
      return 0;
    }
  }

  // ============================================
  // LISTS (for queues)
  // ============================================

  /**
   * Push to list (queue)
   */
  async lpush(key: string, ...values: string[]): Promise<number> {
    if (!this.client) return 0;
    try {
      return this.client.lpush(key, ...values);
    } catch {
      return 0;
    }
  }

  /**
   * Pop from list
   */
  async rpop(key: string, count: number = 1): Promise<string[]> {
    if (!this.client) return [];
    try {
      if (count === 1) {
        const value = await this.client.rpop(key);
        return value ? [value] : [];
      }
      const values = await this.client.rpop(key, count);
      return values || [];
    } catch {
      return [];
    }
  }

  /**
   * Get list length
   */
  async llen(key: string): Promise<number> {
    if (!this.client) return 0;
    try {
      return this.client.llen(key);
    } catch {
      return 0;
    }
  }

  /**
   * Get range from list
   */
  async lrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.client) return [];
    try {
      return this.client.lrange(key, start, stop);
    } catch {
      return [];
    }
  }

  // ============================================
  // SORTED SETS (for leaderboards, rankings)
  // ============================================

  /**
   * Add to sorted set
   */
  async zadd(key: string, score: number, member: string): Promise<number> {
    if (!this.client) return 0;
    try {
      return this.client.zadd(key, score, member);
    } catch {
      return 0;
    }
  }

  /**
   * Get top N from sorted set
   */
  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    if (!this.client) return [];
    try {
      return this.client.zrevrange(key, start, stop);
    } catch {
      return [];
    }
  }

  /**
   * Get top N with scores
   */
  async zrevrangeWithScores(
    key: string,
    start: number,
    stop: number,
  ): Promise<Array<{ member: string; score: number }>> {
    if (!this.client) return [];
    try {
      const result = await this.client.zrevrange(key, start, stop, 'WITHSCORES');
      const items: Array<{ member: string; score: number }> = [];
      for (let i = 0; i < result.length; i += 2) {
        items.push({
          member: result[i],
          score: parseFloat(result[i + 1]),
        });
      }
      return items;
    } catch {
      return [];
    }
  }

  // ============================================
  // PUB/SUB (for real-time updates)
  // ============================================

  /**
   * Publish message to channel
   */
  async publish(channel: string, message: unknown): Promise<number> {
    if (!this.client) return 0;
    try {
      const serialized = typeof message === 'string' ? message : JSON.stringify(message);
      return this.client.publish(channel, serialized);
    } catch {
      return 0;
    }
  }

  /**
   * Subscribe to channel
   */
  async subscribe(channel: string, callback: (message: string) => void): Promise<void> {
    if (!this.subscriber) return;
    try {
      await this.subscriber.subscribe(channel);
      this.subscriber.on('message', (ch, message) => {
        if (ch === channel) {
          callback(message);
        }
      });
    } catch {
      // Ignore
    }
  }

  // ============================================
  // LOCKS (for distributed coordination)
  // ============================================

  /**
   * Acquire a distributed lock
   */
  async acquireLock(key: string, ttlSeconds: number = 30): Promise<boolean> {
    if (!this.client) return true; // No Redis = no lock needed
    try {
      const lockKey = `lock:${key}`;
      const result = await this.client.set(lockKey, '1', 'EX', ttlSeconds, 'NX');
      return result === 'OK';
    } catch {
      return true;
    }
  }

  /**
   * Release a distributed lock
   */
  async releaseLock(key: string): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.del(`lock:${key}`);
    } catch {
      // Ignore
    }
  }

  /**
   * Execute with lock
   */
  async withLock<T>(
    key: string,
    fn: () => Promise<T>,
    ttlSeconds: number = 30,
  ): Promise<T | null> {
    if (!this.client) {
      // No Redis = execute without lock
      return fn();
    }

    const acquired = await this.acquireLock(key, ttlSeconds);
    if (!acquired) {
      return null;
    }

    try {
      return await fn();
    } finally {
      await this.releaseLock(key);
    }
  }
}
