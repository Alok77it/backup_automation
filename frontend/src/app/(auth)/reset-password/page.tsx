"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { authApi } from "@/lib/api";

function ResetForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await authApi.resetPassword(token, password);
    setDone(true);
  }

  return (
    <Card className="w-full max-w-md glass">
      <CardHeader><CardTitle>{done ? "Password updated" : "Set new password"}</CardTitle></CardHeader>
      <CardContent>
        {done ? (
          <a href="/login" className="text-[#10B981] hover:underline">Go to login</a>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
            <Button type="submit" className="w-full">Reset password</Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F3F4F6] p-4">
      <Suspense><ResetForm /></Suspense>
    </div>
  );
}
