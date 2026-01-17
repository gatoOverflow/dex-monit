'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Users,
  Activity,
  Clock,
  Monitor,
  Smartphone,
  Tablet,
  TrendingUp,
  Eye,
  Zap,
  ChevronLeft,
  ChevronRight,
  Search,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Wifi,
  WifiOff,
  RefreshCw,
  Copy,
  Check,
  Timer,
  MapPin,
  Navigation,
  Calendar,
  User,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  sessionsApi,
  projectsApi,
  Session,
  Project,
  ActiveUsersStats,
  SessionStats,
} from '@/lib/api-client';

function formatDuration(ms: number): string {
  if (!ms || ms === 0) return '0s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) {
    const mins = Math.floor(ms / 60000);
    const secs = Math.round((ms % 60000) / 1000);
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  }
  const hours = Math.floor(ms / 3600000);
  const mins = Math.round((ms % 3600000) / 60000);
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatTime(date: string): string {
  return new Date(date).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTimeAgo(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ago`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s ago`;
  if (seconds > 0) return `${seconds}s ago`;
  return 'just now';
}

function formatDate(date: string): string {
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getDeviceIcon(deviceType: string) {
  switch (deviceType?.toLowerCase()) {
    case 'tablet':
      return Tablet;
    case 'phone':
    case 'mobile':
      return Smartphone;
    default:
      return Monitor;
  }
}

const platformColors: Record<string, string> = {
  'react-native': 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  'node': 'bg-green-500/20 text-green-400 border-green-500/30',
  'browser': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  'ios': 'bg-slate-500/20 text-slate-300 border-slate-500/30',
  'android': 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
};

const getPlatformColor = (platform: string): string => {
  return platformColors[platform?.toLowerCase()] || 'bg-muted text-muted-foreground';
};

const getStatusColor = (isActive: boolean): string => {
  return isActive
    ? 'text-emerald-400 bg-emerald-500/10'
    : 'text-muted-foreground bg-muted/50';
};

export default function SessionsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [sessions, setSessions] = useState<Session[]>([]);
  const [stats, setStats] = useState<SessionStats | null>(null);
  const [activeUsers, setActiveUsers] = useState<ActiveUsersStats | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Live mode
  const [isLive, setIsLive] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Expanded rows
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login');
    }
  }, [authLoading, user, router]);

  // Load projects
  useEffect(() => {
    if (!user) return;

    const loadProjects = async () => {
      try {
        const result = await projectsApi.list();
        setProjects(result);
        if (result.length > 0 && !selectedProject) {
          setSelectedProject(result[0].id);
        }
      } catch (err) {
        console.error('Failed to load projects:', err);
      }
    };

    loadProjects();
  }, [user, selectedProject]);

  // Load data
  const loadData = useCallback(async (showLoading = true) => {
    if (!user || !selectedProject) return;

    try {
      if (showLoading) setLoading(true);
      setError(null);

      const [sessionsResult, statsResult, activeResult] = await Promise.all([
        sessionsApi.list({
          projectId: selectedProject,
          platform: platformFilter !== 'all' ? platformFilter : undefined,
          isActive: statusFilter === 'active' ? true : statusFilter === 'ended' ? false : undefined,
          page,
          pageSize: 100,
        }),
        sessionsApi.getStats(selectedProject).catch(() => null),
        sessionsApi.getActiveUsers(selectedProject).catch(() => null),
      ]);

      setSessions(sessionsResult.data);
      setTotalPages(sessionsResult.meta.totalPages);
      setTotal(sessionsResult.meta.total);
      setStats(statsResult);
      setActiveUsers(activeResult);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setError('Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [user, selectedProject, platformFilter, statusFilter, page]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Live polling
  useEffect(() => {
    if (isLive && selectedProject) {
      intervalRef.current = setInterval(() => {
        loadData(false);
      }, 5000);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isLive, selectedProject, loadData]);

  const toggleExpanded = (id: string) => {
    setExpandedSessions((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter sessions locally for search
  const filteredSessions = sessions.filter((session) => {
    if (search) {
      const searchLower = search.toLowerCase();
      return (
        session.userId?.toLowerCase().includes(searchLower) ||
        session.sessionId.toLowerCase().includes(searchLower) ||
        session.ip?.toLowerCase().includes(searchLower) ||
        session.entryPage?.toLowerCase().includes(searchLower)
      );
    }
    return true;
  });

  if (authLoading || !user) {
    return null;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="animate-fade-in">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight">User Sessions</h1>
              {isLive && (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs text-emerald-400 font-medium">LIVE</span>
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              {lastUpdate && `Last update: ${formatTimeAgo(lastUpdate.toISOString())}`}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Toggle */}
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
              {isLive ? (
                <Wifi className="h-4 w-4 text-emerald-400" />
              ) : (
                <WifiOff className="h-4 w-4 text-muted-foreground" />
              )}
              <span className="text-sm">Live</span>
              <Switch checked={isLive} onCheckedChange={setIsLive} />
            </div>

            {/* Manual Refresh */}
            <Button
              variant="outline"
              size="icon"
              onClick={() => loadData()}
              disabled={loading}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>

            {/* Project Selector */}
            <Select value={selectedProject} onValueChange={setSelectedProject}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Select project" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Stats Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6 animate-fade-in" style={{ animationDelay: '50ms' }}>
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold text-emerald-400">{activeUsers?.now ?? 0}</p>
                <p className="text-xs text-muted-foreground">Active Now</p>
              </div>
              <Zap className="h-8 w-8 text-emerald-500/50" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{activeUsers?.today ?? 0}</p>
                <p className="text-xs text-muted-foreground">Today</p>
              </div>
              <Users className="h-8 w-8 text-blue-500/50" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{stats?.totalSessions ?? 0}</p>
                <p className="text-xs text-muted-foreground">Total Sessions</p>
              </div>
              <Activity className="h-8 w-8 text-primary/50" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{formatDuration(stats?.avgDurationMs ?? 0)}</p>
                <p className="text-xs text-muted-foreground">Avg Duration</p>
              </div>
              <Timer className="h-8 w-8 text-yellow-500/50" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{(stats?.avgPageViews ?? 0).toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">Pages/Session</p>
              </div>
              <Eye className="h-8 w-8 text-purple-500/50" />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className={`text-2xl font-bold ${(stats?.bounceRate ?? 0) > 0.5 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {((stats?.bounceRate ?? 0) * 100).toFixed(0)}%
                </p>
                <p className="text-xs text-muted-foreground">Bounce Rate</p>
              </div>
              <TrendingUp className="h-8 w-8 text-orange-500/50" />
            </div>
          </div>
        </div>

        {/* Filters Bar */}
        <div
          className="animate-fade-in flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4"
          style={{ animationDelay: '100ms' }}
        >
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by user, session ID, IP..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 bg-muted/50 border-0"
            />
          </div>
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
            <Select
              value={platformFilter}
              onValueChange={(value) => {
                setPlatformFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[140px] bg-muted/50 border-0">
                <SelectValue placeholder="Platform" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Platforms</SelectItem>
                <SelectItem value="react-native">React Native</SelectItem>
                <SelectItem value="browser">Browser</SelectItem>
                <SelectItem value="node">Node.js</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(value) => {
                setStatusFilter(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[120px] bg-muted/50 border-0">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="ended">Ended</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground">
            {total.toLocaleString()} sessions
          </div>
        </div>

        {/* Sessions Table */}
        <div
          className="animate-fade-in rounded-xl border border-border bg-card overflow-hidden"
          style={{ animationDelay: '150ms' }}
        >
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-2 border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <div className="col-span-1">Status</div>
            <div className="col-span-2">User</div>
            <div className="col-span-2">Device</div>
            <div className="col-span-1">Platform</div>
            <div className="col-span-1 text-center">Pages</div>
            <div className="col-span-2 text-center">Duration</div>
            <div className="col-span-2">Last Activity</div>
            <div className="col-span-1"></div>
          </div>

          {/* Loading State */}
          {loading && sessions.length === 0 ? (
            <div className="divide-y divide-border">
              {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                <div key={i} className="px-4 py-3">
                  <div className="flex items-center gap-4">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-6 w-24 rounded" />
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-6 w-16 ml-auto rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredSessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h3 className="mt-4 text-lg font-medium">No sessions yet</h3>
              <p className="mt-1 text-sm text-muted-foreground max-w-sm text-center">
                User sessions will appear here once your SDK starts tracking
              </p>
            </div>
          ) : (
            <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
              {filteredSessions.map((session, index) => {
                const isExpanded = expandedSessions.has(session.id);
                const isNew = index < 3 && isLive && session.isActive;
                const DeviceIcon = getDeviceIcon(session.deviceType);

                return (
                  <div key={session.id} className={isNew ? 'animate-pulse-once' : ''}>
                    {/* Main Row */}
                    <div
                      className={`grid grid-cols-12 gap-2 px-4 py-2.5 transition-colors hover:bg-muted/20 cursor-pointer ${
                        isExpanded ? 'bg-muted/30' : ''
                      }`}
                      onClick={() => toggleExpanded(session.id)}
                    >
                      {/* Status */}
                      <div className="col-span-1 flex items-center">
                        <span className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${getStatusColor(session.isActive)}`}>
                          {session.isActive && (
                            <span className="relative flex h-1.5 w-1.5">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                            </span>
                          )}
                          {session.isActive ? 'Active' : 'Ended'}
                        </span>
                      </div>

                      {/* User */}
                      <div className="col-span-2 flex items-center min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-muted shrink-0">
                            <User className="h-3.5 w-3.5 text-muted-foreground" />
                          </div>
                          <span className="text-sm truncate">
                            {session.userId || 'Anonymous'}
                          </span>
                        </div>
                      </div>

                      {/* Device */}
                      <div className="col-span-2 flex items-center min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <DeviceIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground truncate">
                            {session.deviceBrand && session.deviceModel
                              ? `${session.deviceBrand} ${session.deviceModel}`
                              : session.osName
                              ? `${session.osName} ${session.osVersion || ''}`.trim()
                              : session.deviceType || 'Unknown'}
                          </span>
                        </div>
                      </div>

                      {/* Platform */}
                      <div className="col-span-1 flex items-center">
                        <Badge className={`text-[10px] font-bold ${getPlatformColor(session.platform)}`}>
                          {session.platform}
                        </Badge>
                      </div>

                      {/* Pages */}
                      <div className="col-span-1 flex items-center justify-center">
                        <span className="font-mono text-sm">{session.pageViews}</span>
                      </div>

                      {/* Duration */}
                      <div className="col-span-2 flex items-center justify-center">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                session.durationMs > 600000 ? 'bg-emerald-500' :
                                session.durationMs > 60000 ? 'bg-blue-500' :
                                'bg-muted-foreground'
                              }`}
                              style={{ width: `${Math.min(100, (session.durationMs / 600000) * 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-xs text-muted-foreground">
                            {formatDuration(session.durationMs)}
                          </span>
                        </div>
                      </div>

                      {/* Last Activity */}
                      <div className="col-span-2 flex items-center">
                        <span className="text-xs text-muted-foreground">
                          {formatTimeAgo(session.lastActivity)}
                        </span>
                      </div>

                      {/* Expand */}
                      <div className="col-span-1 flex items-center justify-end">
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {/* Expanded Details */}
                    {isExpanded && (
                      <div className="border-t border-border bg-[#0a0a12] px-4 py-4">
                        <div className="grid grid-cols-3 gap-6">
                          {/* Session Info */}
                          <div className="space-y-4">
                            <div>
                              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                                Session Info
                              </h4>
                              <div className="rounded-lg bg-muted/30 p-3 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">Session ID</span>
                                  <div className="flex items-center gap-1">
                                    <span className="font-mono">{session.sessionId.slice(0, 12)}...</span>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-5 w-5"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        copyToClipboard(session.sessionId, session.id);
                                      }}
                                    >
                                      {copiedId === session.id ? (
                                        <Check className="h-3 w-3 text-emerald-400" />
                                      ) : (
                                        <Copy className="h-3 w-3" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">Started</span>
                                  <span>{formatDate(session.startedAt)}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">Duration</span>
                                  <span className="font-medium">{formatDuration(session.durationMs)}</span>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">Page Views</span>
                                  <span className="font-medium">{session.pageViews}</span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Device Info */}
                          <div className="space-y-4">
                            <div>
                              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                                Device
                              </h4>
                              <div className="rounded-lg bg-muted/30 p-3 space-y-2">
                                <div className="flex items-center gap-3 pb-2 border-b border-border">
                                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                                    <DeviceIcon className="h-5 w-5 text-muted-foreground" />
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium">
                                      {session.deviceBrand && session.deviceModel
                                        ? `${session.deviceBrand} ${session.deviceModel}`
                                        : session.deviceType || 'Unknown Device'}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {session.osName} {session.osVersion}
                                    </p>
                                  </div>
                                </div>
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-muted-foreground">Platform</span>
                                  <Badge className={`text-[10px] ${getPlatformColor(session.platform)}`}>
                                    {session.platform}
                                  </Badge>
                                </div>
                                {session.appVersion && (
                                  <div className="flex items-center justify-between text-xs">
                                    <span className="text-muted-foreground">App Version</span>
                                    <span>{session.appVersion}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Location & Journey */}
                          <div className="space-y-4">
                            {/* Location */}
                            {(session.ip || session.country) && (
                              <div>
                                <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                                  Location
                                </h4>
                                <div className="rounded-lg bg-muted/30 p-3 space-y-2">
                                  <div className="flex items-center gap-2">
                                    <MapPin className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm">
                                      {session.city && session.country
                                        ? `${session.city}, ${session.country}`
                                        : session.country || 'Unknown'}
                                    </span>
                                  </div>
                                  {session.ip && (
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="text-muted-foreground">IP</span>
                                      <span className="font-mono">{session.ip}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Journey */}
                            <div>
                              <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2">
                                Journey
                              </h4>
                              <div className="rounded-lg bg-muted/30 p-3 space-y-2">
                                {session.entryPage && (
                                  <div className="flex items-center gap-2 text-xs">
                                    <Navigation className="h-3 w-3 text-emerald-400" />
                                    <span className="text-muted-foreground">Entry:</span>
                                    <span className="font-mono truncate">{session.entryPage}</span>
                                  </div>
                                )}
                                {session.exitPage && session.exitPage !== session.entryPage && (
                                  <div className="flex items-center gap-2 text-xs">
                                    <Navigation className="h-3 w-3 text-red-400 rotate-180" />
                                    <span className="text-muted-foreground">Exit:</span>
                                    <span className="font-mono truncate">{session.exitPage}</span>
                                  </div>
                                )}
                                {session.referrer && (
                                  <div className="flex items-center gap-2 text-xs pt-2 border-t border-border">
                                    <span className="text-muted-foreground">Referrer:</span>
                                    <span className="font-mono truncate text-[10px]">{session.referrer}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Pagination */}
        {!loading && totalPages > 1 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Page {page} of {totalPages}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page === totalPages}
                onClick={() => setPage(page + 1)}
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes pulse-once {
          0% { background-color: rgba(16, 185, 129, 0.2); }
          100% { background-color: transparent; }
        }
        .animate-pulse-once {
          animation: pulse-once 1s ease-out;
        }
      `}</style>
    </AppLayout>
  );
}
