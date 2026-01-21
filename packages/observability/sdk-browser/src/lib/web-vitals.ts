/**
 * Web Vitals Collection
 *
 * Collects Core Web Vitals metrics:
 * - LCP (Largest Contentful Paint)
 * - FID (First Input Delay)
 * - CLS (Cumulative Layout Shift)
 * - FCP (First Contentful Paint)
 * - TTFB (Time to First Byte)
 * - INP (Interaction to Next Paint)
 */

export interface WebVitalsMetric {
  name: string;
  value: number;
  rating: 'good' | 'needs-improvement' | 'poor';
  delta: number;
  id: string;
  entries: PerformanceEntry[];
  navigationType: string;
}

export interface WebVitalsConfig {
  onMetric?: (metric: WebVitalsMetric) => void;
  reportAllChanges?: boolean;
}

// Thresholds for ratings (based on Google's recommendations)
const THRESHOLDS = {
  LCP: { good: 2500, poor: 4000 },
  FID: { good: 100, poor: 300 },
  CLS: { good: 0.1, poor: 0.25 },
  FCP: { good: 1800, poor: 3000 },
  TTFB: { good: 800, poor: 1800 },
  INP: { good: 200, poor: 500 },
};

function getRating(
  name: keyof typeof THRESHOLDS,
  value: number,
): 'good' | 'needs-improvement' | 'poor' {
  const threshold = THRESHOLDS[name];
  if (value <= threshold.good) return 'good';
  if (value <= threshold.poor) return 'needs-improvement';
  return 'poor';
}

function generateUniqueId(): string {
  return `v${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function getNavigationType(): string {
  if (typeof window === 'undefined' || !window.performance) return 'unknown';

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
  if (navigation) {
    return navigation.type;
  }

  // Fallback for older browsers
  if ('navigation' in performance && (performance.navigation as PerformanceNavigation)) {
    const types = ['navigate', 'reload', 'back_forward', 'prerender'];
    return types[(performance.navigation as PerformanceNavigation).type] || 'unknown';
  }

  return 'unknown';
}

/**
 * Initialize Web Vitals collection
 */
export function initWebVitals(config: WebVitalsConfig): () => void {
  if (typeof window === 'undefined' || !('PerformanceObserver' in window)) {
    return () => {};
  }

  const observers: PerformanceObserver[] = [];
  const onMetric = config.onMetric || (() => {});
  const reportAllChanges = config.reportAllChanges ?? false;

  // LCP (Largest Contentful Paint)
  try {
    let lcpValue = 0;
    const lcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries() as PerformanceEntry[];
      const lastEntry = entries[entries.length - 1];

      if (lastEntry) {
        const value = (lastEntry as unknown as { startTime: number }).startTime;
        const delta = value - lcpValue;
        lcpValue = value;

        if (reportAllChanges || !lcpValue) {
          onMetric({
            name: 'LCP',
            value,
            rating: getRating('LCP', value),
            delta,
            id: generateUniqueId(),
            entries,
            navigationType: getNavigationType(),
          });
        }
      }
    });

    lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    observers.push(lcpObserver);

    // Report final LCP on visibility hidden
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && lcpValue > 0) {
        onMetric({
          name: 'LCP',
          value: lcpValue,
          rating: getRating('LCP', lcpValue),
          delta: 0,
          id: generateUniqueId(),
          entries: [],
          navigationType: getNavigationType(),
        });
      }
    }, { once: true });
  } catch {
    // LCP not supported
  }

  // FID (First Input Delay)
  try {
    const fidObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries() as PerformanceEventTiming[];
      const firstEntry = entries[0];

      if (firstEntry) {
        const value = firstEntry.processingStart - firstEntry.startTime;
        onMetric({
          name: 'FID',
          value,
          rating: getRating('FID', value),
          delta: value,
          id: generateUniqueId(),
          entries,
          navigationType: getNavigationType(),
        });
      }
    });

    fidObserver.observe({ type: 'first-input', buffered: true });
    observers.push(fidObserver);
  } catch {
    // FID not supported
  }

  // CLS (Cumulative Layout Shift)
  try {
    let clsValue = 0;
    let sessionValue = 0;
    let sessionEntries: PerformanceEntry[] = [];

    const clsObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries() as LayoutShift[];

      for (const entry of entries) {
        // Only count layout shifts without recent user input
        if (!entry.hadRecentInput) {
          const firstSessionEntry = sessionEntries[0] as LayoutShift | undefined;
          const lastSessionEntry = sessionEntries[sessionEntries.length - 1] as LayoutShift | undefined;

          // Session window: 5 second max, 1 second gap
          if (
            sessionValue &&
            firstSessionEntry &&
            lastSessionEntry &&
            entry.startTime - lastSessionEntry.startTime < 1000 &&
            entry.startTime - firstSessionEntry.startTime < 5000
          ) {
            sessionValue += entry.value;
            sessionEntries.push(entry);
          } else {
            sessionValue = entry.value;
            sessionEntries = [entry];
          }

          // Report if this is the largest session
          if (sessionValue > clsValue) {
            const delta = sessionValue - clsValue;
            clsValue = sessionValue;

            if (reportAllChanges || delta > 0) {
              onMetric({
                name: 'CLS',
                value: clsValue,
                rating: getRating('CLS', clsValue),
                delta,
                id: generateUniqueId(),
                entries: sessionEntries,
                navigationType: getNavigationType(),
              });
            }
          }
        }
      }
    });

    clsObserver.observe({ type: 'layout-shift', buffered: true });
    observers.push(clsObserver);

    // Report final CLS on visibility hidden
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && clsValue > 0) {
        onMetric({
          name: 'CLS',
          value: clsValue,
          rating: getRating('CLS', clsValue),
          delta: 0,
          id: generateUniqueId(),
          entries: sessionEntries,
          navigationType: getNavigationType(),
        });
      }
    }, { once: true });
  } catch {
    // CLS not supported
  }

  // FCP (First Contentful Paint)
  try {
    const fcpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries();
      const fcpEntry = entries.find((entry) => entry.name === 'first-contentful-paint');

      if (fcpEntry) {
        const value = fcpEntry.startTime;
        onMetric({
          name: 'FCP',
          value,
          rating: getRating('FCP', value),
          delta: value,
          id: generateUniqueId(),
          entries: [fcpEntry],
          navigationType: getNavigationType(),
        });
      }
    });

    fcpObserver.observe({ type: 'paint', buffered: true });
    observers.push(fcpObserver);
  } catch {
    // FCP not supported
  }

  // TTFB (Time to First Byte)
  try {
    const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
    if (navigation) {
      const value = navigation.responseStart - navigation.requestStart;
      if (value > 0) {
        onMetric({
          name: 'TTFB',
          value,
          rating: getRating('TTFB', value),
          delta: value,
          id: generateUniqueId(),
          entries: [navigation],
          navigationType: navigation.type,
        });
      }
    }
  } catch {
    // TTFB not supported
  }

  // INP (Interaction to Next Paint)
  try {
    let maxINP = 0;
    const inpObserver = new PerformanceObserver((entryList) => {
      const entries = entryList.getEntries() as PerformanceEventTiming[];

      for (const entry of entries) {
        // Only count entries with interactionId (actual user interactions)
        if (entry.interactionId) {
          const value = entry.duration;

          if (value > maxINP) {
            const delta = value - maxINP;
            maxINP = value;

            if (reportAllChanges || delta > 0) {
              onMetric({
                name: 'INP',
                value,
                rating: getRating('INP', value),
                delta,
                id: generateUniqueId(),
                entries: [entry],
                navigationType: getNavigationType(),
              });
            }
          }
        }
      }
    });

    inpObserver.observe({
      type: 'event',
      buffered: true,
      // @ts-expect-error durationThreshold is not in the types
      durationThreshold: 40,
    });
    observers.push(inpObserver);

    // Report final INP on visibility hidden
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && maxINP > 0) {
        onMetric({
          name: 'INP',
          value: maxINP,
          rating: getRating('INP', maxINP),
          delta: 0,
          id: generateUniqueId(),
          entries: [],
          navigationType: getNavigationType(),
        });
      }
    }, { once: true });
  } catch {
    // INP not supported
  }

  // Return cleanup function
  return () => {
    observers.forEach((observer) => observer.disconnect());
  };
}

// Type declarations for Layout Shift API
interface LayoutShift extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}

// Type declarations for Event Timing API
interface PerformanceEventTiming extends PerformanceEntry {
  processingStart: number;
  processingEnd: number;
  interactionId?: number;
}
