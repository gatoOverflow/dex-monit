'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  AlertTriangle,
  FileText,
  FolderOpen,
  Bell,
  Settings,
  LogOut,
  Menu,
  X,
  Bug,
  Users,
  ChevronRight,
  Zap,
  Search,
  Activity,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
}

const mainNavigation: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { label: 'Issues', href: '/issues', icon: AlertTriangle },
  { label: 'Logs', href: '/logs', icon: FileText },
  { label: 'Traces', href: '/traces', icon: Activity },
];

const manageNavigation: NavItem[] = [
  { label: 'Projects', href: '/projects', icon: FolderOpen },
  { label: 'Teams', href: '/teams', icon: Users },
  { label: 'Alerts', href: '/alerts', icon: Bell },
  { label: 'Settings', href: '/settings', icon: Settings },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);

  const handleLogout = () => {
    logout();
    router.push('/auth/login');
  };

  const NavLink = ({ item }: { item: NavItem }) => {
    const isActive =
      pathname === item.href || pathname.startsWith(`${item.href}/`);
    return (
      <Link
        href={item.href}
        className={cn(
          'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
        onClick={() => setSidebarOpen(false)}
      >
        <item.icon className={cn('h-4 w-4', isActive && 'text-primary')} />
        <span className="flex-1">{item.label}</span>
        {item.badge && (
          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
            {item.badge}
          </span>
        )}
        {isActive && (
          <ChevronRight className="h-4 w-4 text-primary opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </Link>
    );
  };

  return (
    <div className="flex min-h-screen bg-background">
      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-0 top-0 z-50 flex h-full w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 ease-in-out lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-purple-500">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="text-base font-semibold text-foreground">Dex</span>
            <span className="text-xs text-muted-foreground">Monitoring</span>
          </div>
          <button
            className="ml-auto rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Search */}
        <div className="p-4">
          <button className="flex w-full items-center gap-3 rounded-lg border border-sidebar-border bg-sidebar-accent px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/30 hover:text-foreground">
            <Search className="h-4 w-4" />
            <span>Search...</span>
            <kbd className="ml-auto hidden rounded border border-sidebar-border bg-sidebar px-1.5 py-0.5 text-xs sm:inline">
              ⌘K
            </kbd>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-6 overflow-y-auto px-4 pb-4">
          {/* Main */}
          <div>
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              Monitor
            </p>
            <div className="space-y-1">
              {mainNavigation.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </div>

          {/* Manage */}
          <div>
            <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
              Manage
            </p>
            <div className="space-y-1">
              {manageNavigation.map((item) => (
                <NavLink key={item.href} item={item} />
              ))}
            </div>
          </div>
        </nav>

        {/* User section */}
        <div className="border-t border-sidebar-border p-4">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-purple-500/80 text-sm font-semibold text-white">
              {user?.name?.charAt(0).toUpperCase() ||
                user?.email?.charAt(0).toUpperCase() ||
                'U'}
            </div>
            <div className="flex-1 truncate">
              <p className="truncate text-sm font-medium text-foreground">
                {user?.name || 'User'}
              </p>
              <p className="truncate text-xs text-muted-foreground">
                {user?.email}
              </p>
            </div>
          </div>
          <div className="mt-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-muted-foreground hover:text-destructive"
              onClick={handleLogout}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-1 flex-col lg:pl-64">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-border bg-background/80 px-6 backdrop-blur-md">
          <button
            className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Breadcrumb placeholder */}
          <div className="flex-1" />

          {/* Actions */}
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="hidden gap-2 text-muted-foreground sm:flex"
            >
              <Bug className="h-4 w-4" />
              <span>Feedback</span>
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground"
            >
              <Bell className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 bg-dots">
          <div className="mx-auto max-w-7xl p-6 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default AppLayout;
