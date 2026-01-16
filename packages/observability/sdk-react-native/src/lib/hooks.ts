import { useEffect, useCallback, useRef } from 'react';
import { captureException, captureMessage, addBreadcrumb, setUser, UserContext } from './client';

interface NavigationRef {
  current: {
    addListener?: (event: string, callback: () => void) => (() => void) | void;
    getCurrentRoute?: () => { name?: string } | undefined;
  } | null;
}

/**
 * Hook to capture navigation breadcrumbs
 * 
 * @example
 * ```tsx
 * // With React Navigation
 * const navigationRef = useNavigationContainerRef();
 * useDexNavigation(navigationRef);
 * ```
 */
export function useDexNavigation(navigationRef: NavigationRef): void {
  const routeNameRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!navigationRef.current) return;

    const unsubscribe = navigationRef.current.addListener?.('state', () => {
      const previousRouteName = routeNameRef.current;
      const currentRouteName = navigationRef.current?.getCurrentRoute?.()?.name;

      if (previousRouteName !== currentRouteName && currentRouteName) {
        addBreadcrumb({
          type: 'navigation',
          category: 'navigation',
          message: `Navigated to ${currentRouteName}`,
          level: 'info',
          data: {
            from: previousRouteName,
            to: currentRouteName,
          },
        });

        routeNameRef.current = currentRouteName;
      }
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [navigationRef]);
}

/**
 * Hook to set user context
 * 
 * @example
 * ```tsx
 * useDexUser({ id: user.id, email: user.email });
 * ```
 */
export function useDexUser(user: UserContext | null): void {
  useEffect(() => {
    setUser(user);

    return () => {
      // Don't clear user on unmount - let the app manage that
    };
  }, [user?.id, user?.email, user?.username]);
}

/**
 * Hook to capture errors with additional context
 * 
 * @example
 * ```tsx
 * const captureError = useDexError({ screen: 'HomeScreen' });
 * 
 * try {
 *   // some code
 * } catch (error) {
 *   captureError(error);
 * }
 * ```
 */
export function useDexError(context?: Record<string, unknown>): (error: Error | string) => Promise<string | null> {
  const contextRef = useRef(context);

  useEffect(() => {
    contextRef.current = context;
  }, [context]);

  return useCallback((error: Error | string) => {
    return captureException(error, contextRef.current);
  }, []);
}

/**
 * Hook to capture messages
 * 
 * @example
 * ```tsx
 * const capture = useDexCapture();
 * capture.message('User completed onboarding', 'INFO');
 * capture.error(someError);
 * ```
 */
export function useDexCapture(defaultContext?: Record<string, unknown>) {
  const contextRef = useRef(defaultContext);

  useEffect(() => {
    contextRef.current = defaultContext;
  }, [defaultContext]);

  const error = useCallback((err: Error | string, context?: Record<string, unknown>) => {
    return captureException(err, { ...contextRef.current, ...context });
  }, []);

  const message = useCallback(
    (msg: string, level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' = 'INFO', context?: Record<string, unknown>) => {
      return captureMessage(msg, level, { ...contextRef.current, ...context });
    },
    []
  );

  const breadcrumb = useCallback(
    (
      message: string,
      category: string,
      data?: Record<string, unknown>,
      level: 'debug' | 'info' | 'warning' | 'error' = 'info'
    ) => {
      addBreadcrumb({
        type: 'default',
        category,
        message,
        level,
        data,
      });
    },
    []
  );

  return { error, message, breadcrumb };
}

/**
 * Hook to track screen views
 * 
 * @example
 * ```tsx
 * function HomeScreen() {
 *   useDexScreenView('HomeScreen');
 *   return <View>...</View>;
 * }
 * ```
 */
export function useDexScreenView(screenName: string, params?: Record<string, unknown>): void {
  useEffect(() => {
    addBreadcrumb({
      type: 'navigation',
      category: 'screen',
      message: `Viewed ${screenName}`,
      level: 'info',
      data: {
        screen: screenName,
        ...params,
      },
    });
  }, [screenName]);
}

/**
 * Hook to track user actions
 * 
 * @example
 * ```tsx
 * const trackAction = useDexAction('HomeScreen');
 * 
 * <Button onPress={() => trackAction('button_clicked', { buttonId: 'submit' })} />
 * ```
 */
export function useDexAction(component: string): (action: string, data?: Record<string, unknown>) => void {
  return useCallback(
    (action: string, data?: Record<string, unknown>) => {
      addBreadcrumb({
        type: 'default',
        category: 'ui.action',
        message: action,
        level: 'info',
        data: {
          component,
          ...data,
        },
      });
    },
    [component]
  );
}
