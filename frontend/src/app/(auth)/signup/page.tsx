"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { HardDrive, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { authApi, saveAuth, ApiError } from "@/lib/api";

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["Weak", "Fair", "Good", "Strong"];
  const colors = ["bg-red-500", "bg-amber-500", "bg-yellow-500", "bg-[#212121]0"];
  return { score, label: labels[score - 1] || "Too short", color: colors[score - 1] || "bg-gray-300" };
}

export default function SignupPage() {
  const router = useRouter();
  const [form, setForm] = useState({ email: "", password: "", full_name: "", organization_name: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const strength = passwordStrength(form.password);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const data = await authApi.signup(form);
      saveAuth(data);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0b0b] p-4">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f36458]">
            <HardDrive className="h-7 w-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-[#f36458]">Create Account</h1>
        </div>
        <Card className="glass card-shadow">
          <CardHeader>
            <CardTitle>Get started</CardTitle>
            <CardDescription>Create your organization and start protecting infrastructure</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600">{error}</div>}
              <Input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
              <Input placeholder="Organization name" value={form.organization_name} onChange={(e) => setForm({ ...form, organization_name: e.target.value })} required />
              <Input type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              <div>
                <Input type="password" placeholder="Password (min 8 chars)" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
                {form.password && (
                  <div className="mt-2">
                    <div className="flex gap-1">
                      {[1, 2, 3, 4].map((i) => (
                        <div key={i} className={`h-1 flex-1 rounded ${i <= strength.score ? strength.color : "bg-gray-200"}`} />
                      ))}
                    </div>
                    <p className="mt-1 text-xs text-gray-500">{strength.label}</p>
                  </div>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create account"}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-gray-500">
              Have an account? <Link href="/login" className="text-[#f36458] hover:underline">Sign in</Link>
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
