"use client";

import { useActionState, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { loginAction, type LoginState } from "@/lib/auth/login-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_LOGO_INITIAL, APP_NAME, APP_TAGLINE } from "@/lib/branding";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState<LoginState, FormData>(
    loginAction,
    {},
  );
  const [showPwd, setShowPwd] = useState(false);

  return (
    <div className="h-screen flex items-center justify-center bg-background p-4">
      <div className="enter swatch-bar-top overflow-hidden w-full max-w-sm rounded-xl border border-border bg-card shadow-lg">
        <div className="px-6 py-6 border-b border-border">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="size-8 bg-foreground rounded-lg flex items-center justify-center">
              <span className="text-background text-sm font-black">{APP_LOGO_INITIAL}</span>
            </div>
            <span className="font-display font-bold text-lg tracking-tight">{APP_NAME}</span>
          </div>
          <p className="eyebrow mb-1.5">Console access</p>
          <h1 className="font-display text-2xl font-bold tracking-tight">Sign in</h1>
          <p className="text-sm text-muted-foreground mt-1">{APP_TAGLINE}</p>
        </div>
        <form action={formAction} className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label
              htmlFor="email"
              className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Email
            </Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              placeholder="admin@company.com"
              disabled={isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label
              htmlFor="password"
              className="text-xs font-semibold uppercase tracking-widest text-muted-foreground"
            >
              Password
            </Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPwd ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="pr-10"
                disabled={isPending}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPwd ? "Hide password" : "Show password"}
                disabled={isPending}
                suppressHydrationWarning
              >
                {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          {state.error && (
            <p className="text-xs text-destructive font-mono">{state.error}</p>
          )}
          <Button type="submit" disabled={isPending} className="w-full" suppressHydrationWarning>
            {isPending ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
