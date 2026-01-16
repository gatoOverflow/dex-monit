'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Plus,
  Trash2,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  Zap,
  Mail,
  MessageSquare,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { AppLayout } from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { projectsApi, alertRulesApi, Project, AlertRule } from '@/lib/api-client';

// Slack icon component
const SlackIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="currentColor">
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z" />
  </svg>
);

// Backend enum values
const triggerTypes = {
  NEW_ISSUE: { label: 'New issue detected', description: 'Alert when a new error type occurs' },
  ISSUE_REGRESSION: { label: 'Issue regression', description: 'Alert when a resolved issue reappears' },
  THRESHOLD: { label: 'Threshold exceeded', description: 'Alert when X events occur in Y minutes' },
  SPIKE: { label: 'Error spike', description: 'Alert on unusual increase in errors' },
  CUSTOM: { label: 'Custom condition', description: 'Custom alerting rules' },
};

const actionTypes = {
  email: { label: 'Email', icon: Mail, color: 'bg-blue-500' },
  slack: { label: 'Slack', icon: SlackIcon, color: 'bg-[#4A154B]' },
  webhook: { label: 'Webhook', icon: Zap, color: 'bg-emerald-500' },
  discord: { label: 'Discord', icon: MessageSquare, color: 'bg-indigo-500' },
};

export default function AlertsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [alertRules, setAlertRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // New rule form
  const [newRule, setNewRule] = useState({
    name: '',
    triggerType: 'THRESHOLD' as keyof typeof triggerTypes,
    threshold: 10,
    timeWindow: 60,
    actionType: 'email' as keyof typeof actionTypes,
    // Email specific
    recipients: '',
    // Slack specific
    slackWebhookUrl: '',
    slackChannel: '#alerts',
    // Webhook specific
    webhookUrl: '',
  });

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login');
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (!user) return;

    const loadData = async () => {
      try {
        setLoading(true);
        setError(null);
        const projectsData = await projectsApi.list().catch(() => []);
        setProjects(projectsData || []);

        // Load alert rules for all projects
        const rulesPromises = (projectsData || []).map((p) =>
          alertRulesApi.list(p.id).catch(() => [])
        );
        const allRules = await Promise.all(rulesPromises);
        setAlertRules(allRules.flat());
      } catch (err) {
        console.error('Failed to load data:', err);
        setError('Failed to load alert rules');
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [user]);

  const handleCreateRule = async () => {
    if (!newRule.name || !selectedProject) return;

    setCreateError(null);

    // Build action config based on type
    let actionConfig: Record<string, unknown> = {};
    
    if (newRule.actionType === 'email') {
      const recipients = newRule.recipients.split(',').map((r) => r.trim()).filter(Boolean);
      if (recipients.length === 0) {
        setCreateError('Please enter at least one email recipient');
        return;
      }
      actionConfig = { to: recipients };
    } else if (newRule.actionType === 'slack') {
      if (!newRule.slackWebhookUrl) {
        setCreateError('Please enter a Slack webhook URL');
        return;
      }
      actionConfig = { webhookUrl: newRule.slackWebhookUrl, channel: newRule.slackChannel };
    } else if (newRule.actionType === 'webhook') {
      if (!newRule.webhookUrl) {
        setCreateError('Please enter a webhook URL');
        return;
      }
      actionConfig = { url: newRule.webhookUrl };
    } else if (newRule.actionType === 'discord') {
      if (!newRule.webhookUrl) {
        setCreateError('Please enter a Discord webhook URL');
        return;
      }
      actionConfig = { webhookUrl: newRule.webhookUrl };
    }

    try {
      setCreating(true);
      const created = await alertRulesApi.create(selectedProject, {
        name: newRule.name,
        triggerType: newRule.triggerType,
        conditions: {},
        threshold: newRule.threshold,
        timeWindow: newRule.timeWindow,
        actions: [
          {
            type: newRule.actionType,
            config: actionConfig,
          },
        ],
      });
      setAlertRules([...alertRules, created]);
      // Reset form
      setNewRule({
        name: '',
        triggerType: 'THRESHOLD',
        threshold: 10,
        timeWindow: 60,
        actionType: 'email',
        recipients: '',
        slackWebhookUrl: '',
        slackChannel: '#alerts',
        webhookUrl: '',
      });
      setSelectedProject('');
      setCreateDialogOpen(false);
    } catch (err) {
      console.error('Failed to create alert rule:', err);
      setCreateError(err instanceof Error ? err.message : 'Failed to create alert rule');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleRule = async (rule: AlertRule) => {
    try {
      if (rule.isEnabled) {
        await alertRulesApi.disable(rule.projectId, rule.id);
      } else {
        await alertRulesApi.enable(rule.projectId, rule.id);
      }
      setAlertRules(
        alertRules.map((r) =>
          r.id === rule.id ? { ...r, isEnabled: !r.isEnabled } : r
        )
      );
    } catch (err) {
      console.error('Failed to toggle alert rule:', err);
    }
  };

  const handleDeleteRule = async (rule: AlertRule) => {
    if (!confirm('Are you sure you want to delete this alert rule?')) return;

    try {
      await alertRulesApi.delete(rule.projectId, rule.id);
      setAlertRules(alertRules.filter((r) => r.id !== rule.id));
    } catch (err) {
      console.error('Failed to delete alert rule:', err);
    }
  };

  const getActionIcon = (type: string) => {
    const action = actionTypes[type as keyof typeof actionTypes];
    return action?.icon || Mail;
  };

  const getActionLabel = (type: string) => {
    const action = actionTypes[type as keyof typeof actionTypes];
    return action?.label || type;
  };

  if (authLoading || !user) {
    return null;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="animate-fade-in">
            <h1 className="text-2xl font-bold tracking-tight">Alerts</h1>
            <p className="text-sm text-muted-foreground">
              Configure notifications for important events
            </p>
          </div>
          <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2" disabled={projects.length === 0}>
                <Plus className="h-4 w-4" />
                Create Alert
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-lg">
              <DialogHeader>
                <DialogTitle>Create Alert Rule</DialogTitle>
                <DialogDescription>
                  Get notified when specific conditions are met.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {createError && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                    <p className="text-sm text-red-400">{createError}</p>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Project</Label>
                  <Select value={selectedProject} onValueChange={setSelectedProject}>
                    <SelectTrigger className="bg-muted/50">
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

                <div className="space-y-2">
                  <Label htmlFor="ruleName">Alert Name</Label>
                  <Input
                    id="ruleName"
                    placeholder="e.g., High error rate alert"
                    value={newRule.name}
                    onChange={(e) => setNewRule({ ...newRule, name: e.target.value })}
                    className="bg-muted/50"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Trigger Type</Label>
                  <Select
                    value={newRule.triggerType}
                    onValueChange={(value) => setNewRule({ ...newRule, triggerType: value as keyof typeof triggerTypes })}
                  >
                    <SelectTrigger className="bg-muted/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(triggerTypes).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {triggerTypes[newRule.triggerType]?.description}
                  </p>
                </div>

                {newRule.triggerType === 'THRESHOLD' && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="threshold">Threshold (events)</Label>
                      <Input
                        id="threshold"
                        type="number"
                        min="1"
                        value={newRule.threshold}
                        onChange={(e) =>
                          setNewRule({ ...newRule, threshold: parseInt(e.target.value) || 1 })
                        }
                        className="bg-muted/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="timeWindow">Time Window (min)</Label>
                      <Input
                        id="timeWindow"
                        type="number"
                        min="1"
                        value={newRule.timeWindow}
                        onChange={(e) =>
                          setNewRule({ ...newRule, timeWindow: parseInt(e.target.value) || 1 })
                        }
                        className="bg-muted/50"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2">
                  <Label>Notification Channel</Label>
                  <Select
                    value={newRule.actionType}
                    onValueChange={(value) => setNewRule({ ...newRule, actionType: value as keyof typeof actionTypes })}
                  >
                    <SelectTrigger className="bg-muted/50">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(actionTypes).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Email config */}
                {newRule.actionType === 'email' && (
                  <div className="space-y-2">
                    <Label htmlFor="recipients">Recipients (comma-separated)</Label>
                    <Input
                      id="recipients"
                      placeholder="alerts@example.com, team@example.com"
                      value={newRule.recipients}
                      onChange={(e) => setNewRule({ ...newRule, recipients: e.target.value })}
                      className="bg-muted/50"
                    />
                  </div>
                )}

                {/* Slack config */}
                {newRule.actionType === 'slack' && (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="slackWebhook">Slack Webhook URL</Label>
                      <Input
                        id="slackWebhook"
                        placeholder="https://hooks.slack.com/services/..."
                        value={newRule.slackWebhookUrl}
                        onChange={(e) => setNewRule({ ...newRule, slackWebhookUrl: e.target.value })}
                        className="bg-muted/50 font-mono text-sm"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="slackChannel">Channel (optional)</Label>
                      <Input
                        id="slackChannel"
                        placeholder="#alerts"
                        value={newRule.slackChannel}
                        onChange={(e) => setNewRule({ ...newRule, slackChannel: e.target.value })}
                        className="bg-muted/50"
                      />
                    </div>
                  </>
                )}

                {/* Webhook/Discord config */}
                {(newRule.actionType === 'webhook' || newRule.actionType === 'discord') && (
                  <div className="space-y-2">
                    <Label htmlFor="webhookUrl">
                      {newRule.actionType === 'discord' ? 'Discord Webhook URL' : 'Webhook URL'}
                    </Label>
                    <Input
                      id="webhookUrl"
                      placeholder={newRule.actionType === 'discord' 
                        ? 'https://discord.com/api/webhooks/...'
                        : 'https://your-api.com/webhook'
                      }
                      value={newRule.webhookUrl}
                      onChange={(e) => setNewRule({ ...newRule, webhookUrl: e.target.value })}
                      className="bg-muted/50 font-mono text-sm"
                    />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreateRule}
                  disabled={!newRule.name || !selectedProject || creating}
                >
                  {creating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    'Create Alert'
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* No Projects Warning */}
        {projects.length === 0 && !loading && (
          <div className="animate-fade-in rounded-xl border border-yellow-500/20 bg-yellow-500/5 p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-yellow-500/10">
                <AlertTriangle className="h-5 w-5 text-yellow-400" />
              </div>
              <div>
                <h3 className="font-medium text-yellow-400">Create a project first</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  You need at least one project to configure alerts.
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-3"
                  onClick={() => router.push('/projects')}
                >
                  Go to Projects
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Alert Rules List */}
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="rounded-xl border border-border bg-card p-6">
                <Skeleton className="h-16" />
              </div>
            ))}
          </div>
        ) : alertRules.length === 0 && projects.length > 0 ? (
          <div className="animate-fade-in rounded-xl border border-border bg-card p-12 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-xl bg-primary/10">
              <Bell className="h-7 w-7 text-primary" />
            </div>
            <h3 className="mt-4 text-lg font-medium">No alerts configured</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first alert rule to get notified.
            </p>
            <Button className="mt-4 gap-2" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Create Alert
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {alertRules.map((rule, index) => {
              const project = projects.find((p) => p.id === rule.projectId);
              const firstAction = Array.isArray(rule.actions) ? rule.actions[0] : null;
              const ActionIcon = getActionIcon(firstAction?.type || 'email');

              return (
                <div
                  key={rule.id}
                  className="animate-fade-in rounded-xl border border-border bg-card overflow-hidden"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <div className="flex items-center justify-between p-6">
                    <div className="flex items-center gap-4">
                      <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                        rule.isEnabled ? 'bg-primary/10' : 'bg-muted'
                      }`}>
                        <Bell className={`h-6 w-6 ${
                          rule.isEnabled ? 'text-primary' : 'text-muted-foreground'
                        }`} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold">{rule.name}</h3>
                          <Badge variant={rule.isEnabled ? 'default' : 'secondary'}>
                            {rule.isEnabled ? 'Active' : 'Disabled'}
                          </Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {triggerTypes[rule.triggerType as keyof typeof triggerTypes]?.label || rule.triggerType}
                        </p>
                        {project && (
                          <Badge variant="outline" className="mt-2">
                            {project.name}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <ActionIcon className="h-4 w-4" />
                        <span className="text-sm">
                          {firstAction ? getActionLabel(firstAction.type) : 'Email'}
                        </span>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleToggleRule(rule)}
                      >
                        {rule.isEnabled ? (
                          <ToggleRight className="h-5 w-5 text-primary" />
                        ) : (
                          <ToggleLeft className="h-5 w-5 text-muted-foreground" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteRule(rule)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {/* Rule Details */}
                  <div className="border-t border-border bg-muted/20 px-6 py-3">
                    <div className="flex items-center gap-6 text-sm text-muted-foreground">
                      {rule.triggerType === 'THRESHOLD' && (
                        <>
                          <span>Threshold: {rule.threshold} events</span>
                          <span>•</span>
                          <span>Time window: {rule.timeWindow} min</span>
                        </>
                      )}
                      {rule.lastTriggeredAt && (
                        <>
                          <span>•</span>
                          <span>
                            Last triggered: {new Date(rule.lastTriggeredAt).toLocaleString()}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
