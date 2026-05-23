"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { HardDrive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#D1FAE5] via-white to-[#F3F4F6] p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl gradient-primary shadow-lg">
            <HardDrive className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold gradient-text">Backup Intelligence</h1>
          <p className="text-sm text-gray-500">AI-Powered Backup & Recovery</p>
        </div>
        <Card className="glass card-shadow">
          <CardHeader>
            <CardTitle>Sign in</CardTitle>
            <CardDescription>Enter your credentials to access the platform</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</div>}
              <div>
                <label className="mb-1.5 block text-sm font-medium">Email</label>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@company.com" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">Password</label>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
              </div>
              <div className="flex justify-end">
                <Link href="/forgot-password" className="text-sm text-[#10B981] hover:underline">Forgot password?</Link>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-gray-500">
              No account? <Link href="/signup" className="font-medium text-[#10B981] hover:underline">Create one</Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
