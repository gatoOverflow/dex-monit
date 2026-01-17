'use client';

import { useEffect, useCallback } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  init,
  trackPageView,
  DexBrowserConfig,
  captureException,
  addBreadcrumb,
} from '../lib/client';

export { DexProvider, useDex, useDexReady } from '../react/provider';
export { DexErrorBoundary, withDexErrorBoundary } from '../react/error-boundary';
export * from '../react/hooks';

/**
 * Initialize Dex for Next.js
 * Should be called once in your root layout or _app
 */
export function initDexNextjs(config: DexBrowserConfig): void {
  if (typeof window !== 'undefined') {
    init(config);
  }
}

/**
 * Hook to auto-track page views on route changes (App Router)
 */
export function useDexPageTracking(): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (pathname) {
      const url = searchParams?.toString()
        ? `${pathname}?${searchParams.toString()}`
        : pathname;

      trackPageView(url);

      addBreadcrumb({
        category: 'navigation',
        message: `Page view: ${url}`,
        level: 'info',
      });
    }
  }, [pathname, searchParams]);
}

/**
 * Hook for route change tracking (works with both App and Pages Router)
 */
export function useDexRouteChange(): void {
  useDexPageTracking();
}

/**
 * Capture errors in Server Actions
 */
export async function captureServerActionError<T>(
  action: () => Promise<T>,
  actionName?: string,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    await captureException(err, {
      type: 'server_action',
      action: actionName,
    });
    throw error;
  }
}

/**
 * Wrapper for Server Components error handling
 */
export function withServerErrorCapture<T extends object>(
  Component: React.ComponentType<T>,
): React.ComponentType<T> {
  return function WrappedComponent(props: T) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createElement } = require('react');
      return createElement(Component, props);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      captureException(err, { type: 'server_component' });
      throw error;
    }
  };
}

/**
 * Create error handler for Next.js API Routes
 */
export function createApiErrorHandler() {
  return function handleApiError(
    handler: (req: Request) => Promise<Response>,
  ): (req: Request) => Promise<Response> {
    return async (req: Request) => {
      try {
        return await handler(req);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        await captureException(err, {
          type: 'api_route',
          url: req.url,
          method: req.method,
        });
        throw error;
      }
    };
  };
}

/**
 * Component to initialize Dex in Next.js App Router layouts
 */
export function DexInit({
  config,
}: {
  config: DexBrowserConfig;
}): null {
  useEffect(() => {
    if (typeof window !== 'undefined') {
      init(config);
    }
  }, [config]);

  return null;
}

/**
 * Use this in error.tsx files to report errors
 */
export function useDexErrorPage(error: Error, reset: () => void) {
  useEffect(() => {
    captureException(error, {
      type: 'next_error_page',
    });
  }, [error]);

  const handleReset = useCallback(() => {
    addBreadcrumb({
      category: 'ui.click',
      message: 'User clicked reset on error page',
      level: 'info',
    });
    reset();
  }, [reset]);

  return { handleReset };
}
