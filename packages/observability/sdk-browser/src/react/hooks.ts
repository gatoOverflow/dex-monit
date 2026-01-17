'use client';

import { useCallback, useEffect, useRef } from 'react';
import {
  captureException,
  captureMessage,
  setUser,
  addBreadcrumb,
  trackPageView,
  getSessionId,
  UserContext,
} from '../lib/client';
import type { Breadcrumb } from '../lib/types';

/**
 * Hook to capture errors
 */
export function useDexCapture() {
  const capture = useCallback(
    async (error: Error | string, context?: Record<string, unknown>) => {
      return captureException(error, context);
    },
    [],
  );

  const message = useCallback(
    async (
      msg: string,
      level: 'debug' | 'info' | 'warning' | 'error' = 'info',
      context?: Record<string, unknown>,
    ) => {
      return captureMessage(msg, level, context);
    },
    [],
  );

  return { capture, message };
}

/**
 * Hook to set user context
 */
export function useDexUser() {
  const identify = useCallback((user: UserContext | null) => {
    setUser(user);
  }, []);

  return { identify, setUser: identify };
}

/**
 * Hook to add breadcrumbs
 */
export function useDexBreadcrumb() {
  const add = useCallback((breadcrumb: Omit<Breadcrumb, 'timestamp'>) => {
    addBreadcrumb(breadcrumb);
  }, []);

  return { add, addBreadcrumb: add };
}

/**
 * Hook to track page views - auto-tracks on mount and route changes
 */
export function useDexPageView(pagePath?: string, pageTitle?: string) {
  const pathRef = useRef(pagePath);
  const titleRef = useRef(pageTitle);

  useEffect(() => {
    trackPageView(pathRef.current, titleRef.current);
  }, []);

  const track = useCallback((path?: string, title?: string) => {
    trackPageView(path, title);
  }, []);

  return { track, trackPageView: track };
}

/**
 * Hook to get current session ID
 */
export function useDexSession() {
  return { sessionId: getSessionId() };
}

/**
 * Hook to capture errors in async operations
 */
export function useDexAsync<T>(
  asyncFn: () => Promise<T>,
  context?: Record<string, unknown>,
): [() => Promise<T | null>, boolean, Error | null] {
  const loadingRef = useRef(false);
  const errorRef = useRef<Error | null>(null);

  const execute = useCallback(async () => {
    loadingRef.current = true;
    errorRef.current = null;

    try {
      const result = await asyncFn();
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      errorRef.current = error;
      captureException(error, context);
      return null;
    } finally {
      loadingRef.current = false;
    }
  }, [asyncFn, context]);

  return [execute, loadingRef.current, errorRef.current];
}

/**
 * Hook for click tracking
 */
export function useDexClick(
  category: string = 'ui.click',
  data?: Record<string, unknown>,
) {
  const track = useCallback(
    (action: string, extraData?: Record<string, unknown>) => {
      addBreadcrumb({
        category,
        message: action,
        level: 'info',
        data: { ...data, ...extraData },
      });
    },
    [category, data],
  );

  return { track };
}

/**
 * Hook for form tracking
 */
export function useDexForm(formName: string) {
  const trackSubmit = useCallback(
    (success: boolean, data?: Record<string, unknown>) => {
      addBreadcrumb({
        category: 'form',
        message: `Form ${formName} ${success ? 'submitted' : 'failed'}`,
        level: success ? 'info' : 'warning',
        data,
      });
    },
    [formName],
  );

  const trackFieldChange = useCallback(
    (fieldName: string) => {
      addBreadcrumb({
        category: 'form',
        message: `Field changed: ${fieldName}`,
        level: 'debug',
        data: { form: formName, field: fieldName },
      });
    },
    [formName],
  );

  return { trackSubmit, trackFieldChange };
}
