/**
 * Offline Queue for React Native
 *
 * Stores events when the device is offline and sends them when connectivity is restored.
 * Uses AsyncStorage for persistence across app restarts.
 */

export interface QueuedEvent {
  id: string;
  type: 'error' | 'log' | 'metric';
  endpoint: string;
  payload: unknown;
  timestamp: string;
  retries: number;
}

export interface OfflineQueueConfig {
  maxQueueSize?: number;
  maxRetries?: number;
  retryDelay?: number;
  debug?: boolean;
  onSendSuccess?: (event: QueuedEvent) => void;
  onSendFailure?: (event: QueuedEvent, error: Error) => void;
}

const STORAGE_KEY = '@dex_monitoring_queue';
const DEFAULT_MAX_QUEUE_SIZE = 100;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY = 5000;

interface InternalState {
  queue: QueuedEvent[];
  isProcessing: boolean;
  isOnline: boolean;
  config: OfflineQueueConfig;
  storage: AsyncStorageInterface | null;
  netInfoUnsubscribe: (() => void) | null;
}

interface AsyncStorageInterface {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

interface NetInfoState {
  isConnected: boolean | null;
}

const state: InternalState = {
  queue: [],
  isProcessing: false,
  isOnline: true,
  config: {},
  storage: null,
  netInfoUnsubscribe: null,
};

/**
 * Initialize the offline queue
 */
export async function initOfflineQueue(config: OfflineQueueConfig = {}): Promise<void> {
  state.config = {
    maxQueueSize: DEFAULT_MAX_QUEUE_SIZE,
    maxRetries: DEFAULT_MAX_RETRIES,
    retryDelay: DEFAULT_RETRY_DELAY,
    ...config,
  };

  // Try to load AsyncStorage
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    state.storage = AsyncStorage;

    // Load persisted queue
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      state.queue = JSON.parse(stored);
      if (state.config.debug) {
        console.log('[DexMonitoring] Loaded', state.queue.length, 'queued events from storage');
      }
    }
  } catch {
    // AsyncStorage not available
    if (state.config.debug) {
      console.log('[DexMonitoring] AsyncStorage not available, using memory-only queue');
    }
  }

  // Try to setup network listener
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NetInfo = require('@react-native-community/netinfo').default;

    state.netInfoUnsubscribe = NetInfo.addEventListener((netState: NetInfoState) => {
      const wasOffline = !state.isOnline;
      state.isOnline = netState.isConnected === true;

      if (wasOffline && state.isOnline) {
        if (state.config.debug) {
          console.log('[DexMonitoring] Network restored, processing queue');
        }
        processQueue();
      }
    });

    // Check initial state
    const netState = await NetInfo.fetch();
    state.isOnline = netState.isConnected === true;
  } catch {
    // NetInfo not available, assume always online
    state.isOnline = true;
  }

  // Process any pending events
  if (state.isOnline && state.queue.length > 0) {
    processQueue();
  }
}

/**
 * Add an event to the queue
 */
export async function enqueue(
  type: QueuedEvent['type'],
  endpoint: string,
  payload: unknown,
): Promise<string> {
  const event: QueuedEvent = {
    id: generateId(),
    type,
    endpoint,
    payload,
    timestamp: new Date().toISOString(),
    retries: 0,
  };

  // Add to queue
  state.queue.push(event);

  // Enforce max queue size (remove oldest events)
  const maxSize = state.config.maxQueueSize || DEFAULT_MAX_QUEUE_SIZE;
  if (state.queue.length > maxSize) {
    state.queue = state.queue.slice(-maxSize);
  }

  // Persist queue
  await persistQueue();

  // Try to process immediately if online
  if (state.isOnline && !state.isProcessing) {
    processQueue();
  }

  return event.id;
}

/**
 * Process queued events
 */
async function processQueue(): Promise<void> {
  if (state.isProcessing || !state.isOnline || state.queue.length === 0) {
    return;
  }

  state.isProcessing = true;

  try {
    // Process events in order
    while (state.queue.length > 0 && state.isOnline) {
      const event = state.queue[0];

      try {
        const response = await fetch(event.endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event.payload),
        });

        if (response.ok) {
          // Success - remove from queue
          state.queue.shift();
          await persistQueue();

          if (state.config.onSendSuccess) {
            state.config.onSendSuccess(event);
          }

          if (state.config.debug) {
            console.log('[DexMonitoring] Sent queued event:', event.id);
          }
        } else if (response.status >= 400 && response.status < 500) {
          // Client error - remove from queue (don't retry)
          state.queue.shift();
          await persistQueue();

          if (state.config.debug) {
            console.log('[DexMonitoring] Dropping event due to client error:', response.status);
          }
        } else {
          // Server error - retry
          throw new Error(`Server error: ${response.status}`);
        }
      } catch (error) {
        // Network or server error
        event.retries++;

        if (event.retries >= (state.config.maxRetries || DEFAULT_MAX_RETRIES)) {
          // Max retries reached - remove from queue
          state.queue.shift();
          await persistQueue();

          if (state.config.onSendFailure) {
            state.config.onSendFailure(event, error as Error);
          }

          if (state.config.debug) {
            console.log('[DexMonitoring] Dropping event after max retries:', event.id);
          }
        } else {
          // Wait before retrying
          await sleep(state.config.retryDelay || DEFAULT_RETRY_DELAY);
        }
      }
    }
  } finally {
    state.isProcessing = false;
  }
}

/**
 * Get current queue size
 */
export function getQueueSize(): number {
  return state.queue.length;
}

/**
 * Check if currently online
 */
export function isOnline(): boolean {
  return state.isOnline;
}

/**
 * Force process the queue
 */
export function flushQueue(): void {
  processQueue();
}

/**
 * Clear all queued events
 */
export async function clearQueue(): Promise<void> {
  state.queue = [];
  await persistQueue();
}

/**
 * Cleanup and stop the offline queue
 */
export function closeOfflineQueue(): void {
  if (state.netInfoUnsubscribe) {
    state.netInfoUnsubscribe();
    state.netInfoUnsubscribe = null;
  }
}

// ============================================
// Internal functions
// ============================================

async function persistQueue(): Promise<void> {
  if (!state.storage) return;

  try {
    await state.storage.setItem(STORAGE_KEY, JSON.stringify(state.queue));
  } catch {
    // Storage error - ignore
  }
}

function generateId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
