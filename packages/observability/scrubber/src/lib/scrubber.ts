/**
 * Default sensitive keys to mask
 */
const DEFAULT_SENSITIVE_KEYS = [
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'apikey',
  'api_key',
  'apiKey',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'authorization',
  'auth',
  'cookie',
  'session',
  'sessionId',
  'session_id',
  'otp',
  'pin',
  'cvv',
  'ssn',
  'credit_card',
  'creditCard',
  'card_number',
  'cardNumber',
  'private_key',
  'privateKey',
];

/**
 * Mask value for scrubbed fields
 */
const MASK = '[REDACTED]';

/**
 * Options for the scrubber
 */
export interface ScrubberOptions {
  /** Additional sensitive keys to mask (merged with defaults) */
  additionalKeys?: string[];
  /** Keys to exclude from default sensitive list */
  excludeKeys?: string[];
  /** Custom mask value */
  mask?: string;
  /** Max depth for recursive scrubbing */
  maxDepth?: number;
  /** Whether key matching is case-insensitive (default: true) */
  caseInsensitive?: boolean;
}

/**
 * Check if a key is sensitive
 */
function isSensitiveKey(
  key: string,
  sensitiveKeys: Set<string>,
  caseInsensitive: boolean
): boolean {
  const normalizedKey = caseInsensitive ? key.toLowerCase() : key;
  
  for (const sensitiveKey of sensitiveKeys) {
    const normalizedSensitiveKey = caseInsensitive 
      ? sensitiveKey.toLowerCase() 
      : sensitiveKey;
    
    // Check for exact match or contains
    if (
      normalizedKey === normalizedSensitiveKey ||
      normalizedKey.includes(normalizedSensitiveKey)
    ) {
      return true;
    }
  }
  
  return false;
}

/**
 * Recursively scrub sensitive data from an object
 */
function scrubRecursive(
  obj: unknown,
  sensitiveKeys: Set<string>,
  mask: string,
  maxDepth: number,
  currentDepth: number,
  caseInsensitive: boolean,
  seen: WeakSet<object>
): unknown {
  // Handle max depth
  if (currentDepth > maxDepth) {
    return '[MAX_DEPTH_REACHED]';
  }

  // Handle primitives and null
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj !== 'object') {
    return obj;
  }

  // Handle circular references
  if (seen.has(obj as object)) {
    return '[CIRCULAR]';
  }
  seen.add(obj as object);

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map((item) =>
      scrubRecursive(
        item,
        sensitiveKeys,
        mask,
        maxDepth,
        currentDepth + 1,
        caseInsensitive,
        seen
      )
    );
  }

  // Handle Error objects
  if (obj instanceof Error) {
    return {
      name: obj.name,
      message: obj.message,
      stack: obj.stack,
    };
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }

  // Handle plain objects
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key, sensitiveKeys, caseInsensitive)) {
      result[key] = mask;
    } else {
      result[key] = scrubRecursive(
        value,
        sensitiveKeys,
        mask,
        maxDepth,
        currentDepth + 1,
        caseInsensitive,
        seen
      );
    }
  }

  return result;
}

/**
 * Scrub sensitive data from an object
 * 
 * @param obj - The object to scrub
 * @param options - Scrubbing options
 * @returns A new object with sensitive data masked
 * 
 * @example
 * ```typescript
 * const data = {
 *   username: 'john',
 *   password: 'secret123',
 *   nested: {
 *     token: 'abc123'
 *   }
 * };
 * 
 * const scrubbed = scrubSensitiveData(data);
 * // Result:
 * // {
 * //   username: 'john',
 * //   password: '[REDACTED]',
 * //   nested: {
 * //     token: '[REDACTED]'
 * //   }
 * // }
 * ```
 */
export function scrubSensitiveData<T>(
  obj: T,
  options: ScrubberOptions = {}
): T {
  const {
    additionalKeys = [],
    excludeKeys = [],
    mask = MASK,
    maxDepth = 10,
    caseInsensitive = true,
  } = options;

  // Build sensitive keys set
  const baseKeys = DEFAULT_SENSITIVE_KEYS.filter(
    (key) => !excludeKeys.includes(key)
  );
  const sensitiveKeys = new Set([...baseKeys, ...additionalKeys]);

  // Create seen WeakSet for circular reference detection
  const seen = new WeakSet<object>();

  return scrubRecursive(
    obj,
    sensitiveKeys,
    mask,
    maxDepth,
    0,
    caseInsensitive,
    seen
  ) as T;
}

/**
 * Create a scrubber with pre-configured options
 * 
 * @param options - Default options for this scrubber instance
 * @returns A scrubber function with the options pre-configured
 */
export function createScrubber(options: ScrubberOptions = {}) {
  return <T>(obj: T, overrideOptions: ScrubberOptions = {}): T => {
    return scrubSensitiveData(obj, { ...options, ...overrideOptions });
  };
}

/**
 * Get the list of default sensitive keys
 */
export function getDefaultSensitiveKeys(): readonly string[] {
  return DEFAULT_SENSITIVE_KEYS;
}
