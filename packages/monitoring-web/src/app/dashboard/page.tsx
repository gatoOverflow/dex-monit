'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  FileText,
  Activity,
  FolderOpen,
  ArrowRight,
  Clock,
  Users,
  Zap,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AppLayout } from '@/components/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  issuesApi,
  projectsApi,
  logsApi,
  sessionsApi,
  Issue,
  Project,
  ActiveUsersStats,
} from '@/lib/api-client';

interface DashboardStats {
  totalIssues: number;
  unresolvedIssues: number;
  totalProjects: number;
  totalLogs: number;
  errorLogs: number;
  activeUsers: ActiveUsersStats | null;
  logsByLevel?: Record<string, number>;
}

export default function DashboardPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [recentIssues, setRecentIssues] = useState<Issue[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;

    const loadDashboardData = async () => {
      try {
        setLoading(true);
        setError(null);

        const projectsResult = await projectsApi.list().catch(() => []);

        let issuesResult = {
          data: [] as Issue[],
          meta: { total: 0, page: 1, pageSize: 5, totalPages: 0 },
        };

        // Only load issues if user has projects
        if (projectsResult.length > 0) {
          try {
            // Fetch issues for each user project and combine
            const projectIds = projectsResult.map((p) => p.id);
            const issuesPromises = projectIds.slice(0, 5).map((projectId) =>
              issuesApi
                .list({
                  projectId,
                  pageSize: 5,
                  sortBy: 'lastSeen',
                  sortOrder: 'desc',
                })
                .catch(() => ({
                  data: [] as Issue[],
                  meta: { total: 0, page: 1, pageSize: 5, totalPages: 0 },
                })),
            );
            const allIssuesResults = await Promise.all(issuesPromises);

            // Combine and sort all issues by lastSeen
            const allIssues = allIssuesResults
              .flatMap((r) => r.data)
              .sort(
                (a, b) =>
                  new Date(b.lastSeen).getTime() -
                  new Date(a.lastSeen).getTime(),
              )
              .slice(0, 5);

            const totalIssues = allIssuesResults.reduce(
              (sum, r) => sum + (r.meta?.total || 0),
              0,
            );

            issuesResult = {
              data: allIssues,
              meta: { total: totalIssues, page: 1, pageSize: 5, totalPages: 1 },
            };
          } catch {
            // No issues yet
          }
        }

        let totalLogs = 0;
        let errorLogs = 0;
        let activeUsers: ActiveUsersStats | null = null;
        let logsByLevel: Record<string, number> = {};

        if (projectsResult.length > 0) {
          try {
            const statsPromises = projectsResult.slice(0, 5).map((p) =>
              logsApi.getStats({ projectId: p.id }).catch(() => ({
                total: 0,
                byLevel: {} as Record<string, number>,
              })),
            );
            const allStats = await Promise.all(statsPromises);
            totalLogs = allStats.reduce((sum, s) => sum + (s?.total || 0), 0);
            errorLogs = allStats.reduce(
              (sum, s) =>
                sum +
                ((s?.byLevel?.['ERROR'] || 0) + (s?.byLevel?.['FATAL'] || 0)),
              0,
            );
            // Aggregate byLevel
            allStats.forEach((s) => {
              if (s?.byLevel) {
                Object.entries(s.byLevel).forEach(([level, count]) => {
                  logsByLevel[level] = (logsByLevel[level] || 0) + count;
                });
              }
            });
          } catch {
            // Ignore stats errors
          }

          // Get active users for the first project
          try {
            activeUsers = await sessionsApi.getActiveUsers(
              projectsResult[0].id,
            );
          } catch {
            // Ignore active users errors
          }
        }

        const unresolvedCount = (issuesResult.data || []).filter(
          (i) => i.status === 'UNRESOLVED',
        ).length;

        setStats({
          totalIssues: issuesResult.meta?.total || 0,
          unresolvedIssues: unresolvedCount,
          totalProjects: projectsResult.length,
          totalLogs,
          errorLogs,
          activeUsers,
          logsByLevel,
        });

        setRecentIssues(issuesResult.data || []);
        setProjects(projectsResult);
      } catch (err) {
        console.error('Failed to load dashboard data:', err);
        setError('Failed to load dashboard data');
      } finally {
        setLoading(false);
      }
    };

    loadDashboardData();
  }, [user]);

  if (authLoading || !user) {
    return null;
  }

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'FATAL':
        return 'bg-red-500/10 text-red-400 border-red-500/20';
      case 'ERROR':
        return 'bg-orange-500/10 text-orange-400 border-orange-500/20';
      case 'WARNING':
        return 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20';
      default:
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    }
  };

  return (
    <AppLayout>
      <div className="space-y-8">
        {/* Welcome header */}
        <div className="animate-fade-in">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="h-4 w-4" />
            <span className="text-sm">
              {new Date().toLocaleDateString('en-US', {
                weekday: 'long',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </div>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">
            Welcome back, {user?.name?.split(' ')[0] || 'there'}
          </h1>
          <p className="mt-1 text-muted-foreground">
            Here&apos;s what&apos;s happening with your applications.
          </p>
        </div>

        {error && (
          <div className="animate-fade-in rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            title="Active Users"
            value={stats?.activeUsers?.now ?? 0}
            subtitle={`${stats?.activeUsers?.today ?? 0} today`}
            loading={loading}
            icon={Users}
            iconBg="bg-green-500/10"
            iconColor="text-green-400"
            onClick={() => router.push('/sessions')}
          />
          <StatCard
            title="Unresolved Issues"
            value={stats?.unresolvedIssues}
            subtitle={`of ${stats?.totalIssues || 0} total`}
            loading={loading}
            icon={AlertTriangle}
            iconBg="bg-orange-500/10"
            iconColor="text-orange-400"
            onClick={() => router.push('/issues?status=UNRESOLVED')}
          />
          <StatCard
            title="Total Logs"
            value={stats?.totalLogs}
            subtitle="Last 24 hours"
            loading={loading}
            icon={FileText}
            iconBg="bg-blue-500/10"
            iconColor="text-blue-400"
            onClick={() => router.push('/logs')}
          />
          <StatCard
            title="Active Projects"
            value={stats?.totalProjects}
            subtitle="Monitored"
            loading={loading}
            icon={FolderOpen}
            iconBg="bg-emerald-500/10"
            iconColor="text-emerald-400"
            onClick={() => router.push('/projects')}
          />
          <StatCard
            title="Error Rate"
            value={stats?.errorLogs}
            subtitle="Errors in logs"
            loading={loading}
            icon={Zap}
            iconBg="bg-red-500/10"
            iconColor="text-red-400"
          />
        </div>

        {/* Recent Issues & Quick Actions */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Recent Issues */}
          <div className="lg:col-span-2">
            <div
              className="animate-fade-in rounded-xl border border-border bg-card"
              style={{ animationDelay: '100ms' }}
            >
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div>
                  <h2 className="text-lg font-semibold">Recent Issues</h2>
                  <p className="text-sm text-muted-foreground">
                    Latest errors from your applications
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-2"
                  onClick={() => router.push('/issues')}
                >
                  View all
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
              <div className="divide-y divide-border">
                {loading ? (
                  <div className="p-6 space-y-4">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center gap-4">
                        <Skeleton className="h-10 w-10 rounded-lg" />
                        <div className="flex-1 space-y-2">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : recentIssues.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/10">
                      <Activity className="h-6 w-6 text-emerald-400" />
                    </div>
                    <h3 className="mt-4 font-medium">All clear!</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      No issues to report. Great job!
                    </p>
                  </div>
                ) : (
                  recentIssues.map((issue) => (
                    <div
                      key={issue.id}
                      className="flex cursor-pointer items-center gap-4 px-6 py-4 transition-colors hover:bg-muted/30"
                      onClick={() => router.push(`/issues/${issue.id}`)}
                    >
                      <div
                        className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                          issue.level === 'FATAL'
                            ? 'bg-red-500/10'
                            : issue.level === 'ERROR'
                              ? 'bg-orange-500/10'
                              : 'bg-yellow-500/10'
                        }`}
                      >
                        <AlertTriangle
                          className={`h-5 w-5 ${
                            issue.level === 'FATAL'
                              ? 'text-red-400'
                              : issue.level === 'ERROR'
                                ? 'text-orange-400'
                                : 'text-yellow-400'
                          }`}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge
                            className={`text-[10px] uppercase ${getLevelColor(issue.level)}`}
                          >
                            {issue.level}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {issue.shortId}
                          </span>
                        </div>
                        <p className="mt-1 truncate font-mono text-sm">
                          {issue.title}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-semibold">
                          {issue.eventCount}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatTimeAgo(issue.lastSeen)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Quick Actions & Projects */}
          <div className="space-y-6">
            {/* Quick Actions */}
            <div
              className="animate-fade-in rounded-xl border border-border bg-card p-6"
              style={{ animationDelay: '150ms' }}
            >
              <h2 className="text-lg font-semibold">Quick Actions</h2>
              <div className="mt-4 space-y-2">
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() => router.push('/projects')}
                >
                  <FolderOpen className="h-4 w-4 text-primary" />
                  Create Project
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() => router.push('/teams')}
                >
                  <Users className="h-4 w-4 text-primary" />
                  Manage Teams
                </Button>
                <Button
                  variant="outline"
                  className="w-full justify-start gap-3"
                  onClick={() => router.push('/alerts')}
                >
                  <Zap className="h-4 w-4 text-primary" />
                  Setup Alerts
                </Button>
              </div>
            </div>

            {/* Active Projects */}
            {projects.length > 0 && (
              <div
                className="animate-fade-in rounded-xl border border-border bg-card p-6"
                style={{ animationDelay: '200ms' }}
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold">Projects</h2>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push('/projects')}
                  >
                    View all
                  </Button>
                </div>
                <div className="mt-4 space-y-2">
                  {projects.slice(0, 4).map((project) => (
                    <div
                      key={project.id}
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-transparent p-3 transition-colors hover:border-border hover:bg-muted/30"
                      onClick={() => router.push(`/projects/${project.id}`)}
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                        {project.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium">
                          {project.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {project.platform}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function StatCard({
  title,
  value,
  subtitle,
  loading,
  icon: Icon,
  iconBg,
  iconColor,
  onClick,
}: {
  title: string;
  value?: number;
  subtitle?: string;
  loading: boolean;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  onClick?: () => void;
}) {
  return (
    <div
      className={`animate-fade-in rounded-xl border border-border bg-card p-6 transition-all ${
        onClick
          ? 'cursor-pointer hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5'
          : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between">
        <div
          className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg}`}
        >
          <Icon className={`h-5 w-5 ${iconColor}`} />
        </div>
        {onClick && (
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
      <div className="mt-4">
        {loading ? (
          <>
            <Skeleton className="h-8 w-20" />
            <Skeleton className="mt-1 h-4 w-24" />
          </>
        ) : (
          <>
            <p className="text-3xl font-bold tracking-tight">
              {value?.toLocaleString() ?? 0}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </>
        )}
      </div>
      <p className="mt-3 text-xs font-medium text-muted-foreground">{title}</p>
    </div>
  );
}

function formatTimeAgo(date: string): string {
  const now = new Date();
  const then = new Date(date);
  const diff = now.getTime() - then.getTime();
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}
