'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff, Zap, ArrowRight, Loader2, Check, Lock } from 'lucide-react';
import { authApi } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// Check if registration is enabled (default: false for security)
const REGISTRATION_ENABLED = process.env.NEXT_PUBLIC_REGISTRATION_ENABLED === 'true';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If registration is disabled, show message
  if (!REGISTRATION_ENABLED) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="mx-auto max-w-md text-center p-8">
          <div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-yellow-500/10">
            <Lock className="h-8 w-8 text-yellow-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Registration Disabled</h1>
          <p className="text-muted-foreground mb-6">
            New account registration is currently disabled. Please contact an administrator if you need access.
          </p>
          <Link href="/auth/login">
            <Button className="gap-2">
              Go to Login
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) return;

    try {
      setLoading(true);
      setError(null);
      await authApi.register(email, password, name);
      router.push('/auth/login?registered=true');
    } catch (err: any) {
      console.error('Registration failed:', err);
      setError(err.message || 'Failed to create account');
    } finally {
      setLoading(false);
    }
  };

  const passwordChecks = [
    { label: 'At least 8 characters', valid: password.length >= 8 },
    { label: 'Contains a number', valid: /\d/.test(password) },
  ];

  return (
    <div className="flex min-h-screen">
      {/* Left side - Decorative */}
      <div className="hidden lg:flex lg:flex-1 lg:items-center lg:justify-center bg-gradient-to-br from-purple-500/20 via-background to-primary/20 relative overflow-hidden">
        <div className="absolute inset-0 bg-dots opacity-50" />
        <div className="relative z-10 max-w-md p-8 text-center">
          <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-primary/10 glow-primary">
            <Zap className="h-10 w-10 text-primary" />
          </div>
          <h2 className="text-3xl font-bold">
            Start monitoring
            <br />
            <span className="gradient-text">in minutes</span>
          </h2>
          <p className="mt-4 text-muted-foreground">
            Get started with powerful error tracking and log management for your applications.
          </p>
          <div className="mt-8 space-y-3 text-left">
            {[
              'Real-time error monitoring',
              'Structured log aggregation',
              'Smart alert notifications',
              'Team collaboration built-in',
            ].map((feature) => (
              <div key={feature} className="flex items-center gap-3">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20">
                  <Check className="h-3.5 w-3.5 text-primary" />
                </div>
                <span className="text-sm">{feature}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right side - Form */}
      <div className="flex flex-1 flex-col justify-center px-8 py-12 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          {/* Logo */}
          <Link href="/" className="mb-8 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-purple-500">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <span className="text-xl font-bold">Dex Monitoring</span>
          </Link>

          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold tracking-tight">Create an account</h1>
            <p className="mt-2 text-muted-foreground">
              Get started with Dex Monitoring today
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-6 rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input
                id="name"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 bg-muted/50"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-11 bg-muted/50"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 bg-muted/50 pr-10"
                  required
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </button>
              </div>
              {/* Password requirements */}
              {password && (
                <div className="mt-2 space-y-1">
                  {passwordChecks.map((check) => (
                    <div
                      key={check.label}
                      className={`flex items-center gap-2 text-xs ${
                        check.valid ? 'text-emerald-400' : 'text-muted-foreground'
                      }`}
                    >
                      <Check className={`h-3 w-3 ${check.valid ? 'opacity-100' : 'opacity-30'}`} />
                      {check.label}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <Button
              type="submit"
              className="h-11 w-full gap-2"
              disabled={loading || password.length < 8}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Creating account...
                </>
              ) : (
                <>
                  Create account
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          {/* Footer */}
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Already have an account?{' '}
            <Link
              href="/auth/login"
              className="font-medium text-primary hover:underline"
            >
              Sign in
            </Link>
          </p>

          {/* Terms */}
          <p className="mt-4 text-center text-xs text-muted-foreground">
            By creating an account, you agree to our{' '}
            <Link href="/terms" className="underline hover:text-foreground">
              Terms of Service
            </Link>{' '}
            and{' '}
            <Link href="/privacy" className="underline hover:text-foreground">
              Privacy Policy
            </Link>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
