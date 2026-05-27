"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authApi, saveAuth, ApiError } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await authApi.login({ email, password });
      saveAuth(data);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center p-4"
      style={{ background: "#0b0b0b" }}
    >
      {/* Grid texture */}
      <div className="pointer-events-none fixed inset-0 tech-grid" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-sm"
      >
        {/* Wordmark */}
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="brand-dot" />
            <span className="text-xl font-semibold text-white tracking-tight">
              Backup Intelligence
            </span>
          </div>
          <p
            className="text-[11px] uppercase tracking-widest"
            style={{ fontFamily: "'IBM Plex Mono', monospace", color: "#797979" }}
          >
            AI Recovery Platform
          </p>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Sign in</CardTitle>
            <p className="text-sm" style={{ color: "#797979" }}>
              Enter your credentials to continue
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div
                  className="rounded-[3px] border px-3 py-2.5 text-sm"
                  style={{ background: "rgba(221,0,0,0.08)", borderColor: "#dd0000", color: "#f87171" }}
                >
                  {error}
                </div>
              )}
              <Input
                type="email"
                label="Email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="you@company.com"
              />
              <Input
                type="password"
                label="Password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
              />
              <div className="flex justify-end">
                <Link
                  href="/forgot-password"
                  className="text-xs transition-colors hover:text-white"
                  style={{ color: "#797979" }}
                >
                  Forgot password?
                </Link>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
              </Button>
            </form>
            <p className="mt-5 text-center text-sm" style={{ color: "#797979" }}>
              No account?{" "}
              <Link
                href="/signup"
                className="font-medium text-white transition-colors"
                style={{ color: "#f36458" }}
              >
                Create one
              </Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
