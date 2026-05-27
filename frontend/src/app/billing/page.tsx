"use client";

import { useEffect, useState } from "react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface BillingInfo {
  plan: string; storage_used_gb: number; storage_quota_gb: number;
  members_count: number; servers_count: number; backups_count: number;
}

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingInfo | null>(null);
  useEffect(() => { api<BillingInfo>("/organizations/billing").then(setBilling).catch(() => setBilling({ plan: "starter", storage_used_gb: 0, storage_quota_gb: 100, members_count: 1, servers_count: 0, backups_count: 0 })); }, []);

  return (
    <DashboardLayout title="Billing">
      <Card className="glass max-w-2xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Current Plan</CardTitle>
            <Badge variant="success">{billing?.plan || "starter"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl bg-[#353535] p-4">
              <p className="text-sm text-gray-500">Storage</p>
              <p className="text-xl font-bold">{billing?.storage_used_gb.toFixed(1)} / {billing?.storage_quota_gb} GB</p>
            </div>
            <div className="rounded-xl bg-[#353535] p-4">
              <p className="text-sm text-gray-500">Members</p>
              <p className="text-xl font-bold">{billing?.members_count}</p>
            </div>
            <div className="rounded-xl bg-[#353535] p-4">
              <p className="text-sm text-gray-500">Servers</p>
              <p className="text-xl font-bold">{billing?.servers_count}</p>
            </div>
            <div className="rounded-xl bg-[#353535] p-4">
              <p className="text-sm text-gray-500">Backups</p>
              <p className="text-xl font-bold">{billing?.backups_count}</p>
            </div>
          </div>
          <p className="text-sm text-gray-500">Billing is managed locally. Upgrade plans by updating your organization configuration.</p>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}
