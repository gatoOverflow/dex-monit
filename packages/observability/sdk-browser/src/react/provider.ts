'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  createElement,
  ReactNode,
} from 'react';
import {
  init,
  close,
  isInitialized,
  DexBrowserConfig,
  setUser,
  UserContext,
  captureException,
  captureMessage,
  addBreadcrumb,
  trackPageView,
  getSessionId,
} from '../lib/client';
import type { Breadcrumb } from '../lib/types';

interface DexContextValue {
  isReady: boolean;
  sessionId: string | null;
  setUser: (user: UserContext | null) => void;
  captureException: (error: Error | string, context?: Record<string, unknown>) => Promise<string | null>;
  captureMessage: (
    message: string,
    level?: 'debug' | 'info' | 'warning' | 'error',
    context?: Record<string, unknown>,
  ) => Promise<string | null>;
  addBreadcrumb: (breadcrumb: Omit<Breadcrumb, 'timestamp'>) => void;
  trackPageView: (pagePath?: string, pageTitle?: string) => void;
}

const DexContext = createContext<DexContextValue | null>(null);

interface DexProviderProps {
  config: DexBrowserConfig;
  children: ReactNode;
}

/**
 * Provider component to initialize Dex SDK
 */
export function DexProvider({ config, children }: DexProviderProps): ReactNode {
  const [isReady, setIsReady] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!isInitialized()) {
      init(config);
    }
    setIsReady(true);
    setSessionId(getSessionId());

    return () => {
      close();
    };
  }, [config]);

  const value: DexContextValue = {
    isReady,
    sessionId,
    setUser,
    captureException,
    captureMessage,
    addBreadcrumb,
    trackPageView,
  };

  return createElement(DexContext.Provider, { value }, children);
}

/**
 * Hook to access Dex context
 */
export function useDex(): DexContextValue {
  const context = useContext(DexContext);
  if (!context) {
    throw new Error('useDex must be used within a DexProvider');
  }
  return context;
}

/**
 * Hook to check if Dex is ready
 */
export function useDexReady(): boolean {
  const context = useContext(DexContext);
  return context?.isReady ?? false;
}
