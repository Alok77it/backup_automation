"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import * as Switch from "@radix-ui/react-switch";

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
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
          <CardHeader><CardTitle>Appearance</CardTitle></CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-sm">Dark mode</p>
            <div className="flex items-center gap-3">
              <Switch.Root
                checked={theme === "dark"}
                onCheckedChange={(c) => setTheme(c ? "dark" : "light")}
                className="w-11 h-6 bg-gray-200 rounded-full relative data-[state=checked]:bg-[#10B981] transition"
              >
                <Switch.Thumb className="block w-5 h-5 bg-white rounded-full transition-transform translate-x-0.5 data-[state=checked]:translate-x-[22px]" />
              </Switch.Root>
              <Button variant="outline" size="sm" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
                Toggle theme
              </Button>
            </div>
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
      </div>
    </DashboardLayout>
  );
}
