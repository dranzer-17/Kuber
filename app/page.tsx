"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { isAdminUser } from "@/lib/auth/admin";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { APP_LOGO_INITIAL, APP_NAME, APP_TAGLINE } from "@/lib/branding";

export default function LoginPage() {
  const router = useRouter();

  const [loginEmail,    setLoginEmail   ] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [showPwd,       setShowPwd      ] = useState(false);
  const [authError,     setAuthError    ] = useState("");
  const [signingIn,     setSigningIn    ] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthError("");
    setSigningIn(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password: loginPassword,
    });
    if (error) { setAuthError(error.message); setSigningIn(false); return; }
    if (!isAdminUser(data.user)) {
      await supabase.auth.signOut();
      setAuthError("This account does not have admin access.");
      setSigningIn(false);
      return;
    }
    setSigningIn(false);
    router.push("/dashboard");
  }

  return (
    <div className="h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card shadow-lg overflow-hidden">
        <div className="px-6 py-6 border-b border-border">
          <div className="flex items-center gap-2.5 mb-5">
            <div className="size-8 bg-foreground rounded-lg flex items-center justify-center">
              <span className="text-background text-sm font-black">{APP_LOGO_INITIAL}</span>
            </div>
            <span className="font-bold text-lg">{APP_NAME}</span>
          </div>
          <h1 className="text-2xl font-bold">Sign in</h1>
          <p className="text-sm text-muted-foreground mt-1">{APP_TAGLINE}</p>
        </div>
        <form onSubmit={handleLogin} className="px-6 py-5 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Email
            </Label>
            <Input
              type="email"
              required
              autoComplete="email"
              value={loginEmail}
              onChange={(e) => setLoginEmail(e.target.value)}
              placeholder="admin@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Password
            </Label>
            <div className="relative">
              <Input
                type={showPwd ? "text" : "password"}
                required
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => setLoginPassword(e.target.value)}
                placeholder="••••••••"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPwd ? "Hide password" : "Show password"}
              >
                {showPwd ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          {authError && (
            <p className="text-xs text-destructive font-mono">{authError}</p>
          )}
          <Button type="submit" disabled={signingIn} className="w-full">
            {signingIn ? "Signing in..." : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
