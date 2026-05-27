"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authApi } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6] p-4">
      <Card className="w-full max-w-md glass">
        <CardHeader><CardTitle>Reset password</CardTitle></CardHeader>
        <CardContent>
          {sent ? (
            <p className="text-sm text-gray-600">If an account exists for {email}, a reset link has been sent.</p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" required />
              <Button type="submit" className="w-full" disabled={loading}>Send reset link</Button>
            </form>
          )}
          <Link href="/login" className="mt-4 block text-center text-sm text-[#f36458]">Back to login</Link>
        </CardContent>
      </Card>
    </div>
  );
}
