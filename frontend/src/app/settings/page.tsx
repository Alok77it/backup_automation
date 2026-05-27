"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  const [user, setUser] = useState<{ full_name?: string; email?: string }>({});
  const [role, setRole] = useState("");

  useEffect(() => {
    setUser(JSON.parse(localStorage.getItem("user") || "{}"));
    setRole(localStorage.getItem("role") || "");
  }, []);

  return (
    <DashboardLayout title="Settings">
      <div className="max-w-2xl space-y-6">
        <Card className="glass">
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm"><span className="text-gray-500">Name:</span> {user.full_name}</p>
            <p className="text-sm"><span className="text-gray-500">Email:</span> {user.email}</p>
            <p className="text-sm"><span className="text-gray-500">Role:</span> {role}</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader><CardTitle>Security</CardTitle></CardHeader>
          <CardContent className="text-sm text-gray-500 space-y-2">
            <p>JWT authentication with refresh tokens</p>
            <p>CSRF protection enabled on mutating requests</p>
            <p>Credentials encrypted at rest with Fernet</p>
            <p>Rate limiting active on API endpoints</p>
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader><CardTitle>API Configuration</CardTitle></CardHeader>
          <CardContent className="text-sm text-gray-500 space-y-2">
            <p>Set <code className="rounded bg-[#212121] px-1 py-0.5 text-[#f36458]">ANTHROPIC_API_KEY</code> or <code className="rounded bg-[#212121] px-1 py-0.5 text-[#f36458]">OPENAI_API_KEY</code> in your <code className="rounded bg-[#212121] px-1 py-0.5 text-[#f36458]">.env</code> file for AI-powered analysis.</p>
            <p>After updating .env, restart the API container: <code className="rounded bg-[#212121] px-1 py-0.5 text-[#f36458]">docker compose restart api</code></p>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
