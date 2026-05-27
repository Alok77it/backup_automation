"use client";

import { useEffect, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface Alert { id: string; title: string; message: string; alert_type: string; severity: string; is_read: boolean; is_resolved: boolean; created_at: string }

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const load = () => api<Alert[]>("/alerts").then(setAlerts);
  useEffect(() => { load(); }, []);

  return (
    <DashboardLayout title="Alerts">
      <div className="mb-4 flex gap-2">
        <Button variant="outline" onClick={() => api("/alerts/mark-all-read", { method: "POST" }).then(load)}>Mark all read</Button>
      </div>
      <div className="space-y-3">
        {alerts.map((a) => (
          <Card key={a.id} className={`glass ${!a.is_read ? "border-[#353535]" : ""}`}>
            <CardContent className="flex items-start gap-4 p-4">
              <Bell className={`h-5 w-5 mt-0.5 ${a.severity === "critical" ? "text-red-500" : "text-[#f36458]"}`} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold">{a.title}</h3>
                  <Badge variant={a.severity === "critical" || a.severity === "error" ? "error" : a.severity === "warning" ? "warning" : "info"}>{a.severity}</Badge>
                  <Badge>{a.alert_type}</Badge>
                </div>
                <p className="mt-1 text-sm text-gray-600">{a.message}</p>
                <p className="mt-1 text-xs text-gray-400">{new Date(a.created_at).toLocaleString()}</p>
              </div>
              <div className="flex gap-1">
                {!a.is_read && <Button size="sm" variant="ghost" onClick={() => api(`/alerts/${a.id}/read`, { method: "POST" }).then(load)}><Check className="h-3 w-3" /></Button>}
                {!a.is_resolved && <Button size="sm" variant="ghost" onClick={() => api(`/alerts/${a.id}/resolve`, { method: "POST" }).then(load)}><X className="h-3 w-3" /></Button>}
              </div>
            </CardContent>
          </Card>
        ))}
        {alerts.length === 0 && <p className="text-center text-gray-500 py-12">No alerts — all systems healthy</p>}
      </div>
    </DashboardLayout>
  );
}
