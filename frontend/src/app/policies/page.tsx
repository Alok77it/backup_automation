"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface Policy {
  id: string; name: string; retention_days: number; retention_count: number;
  retry_count: number; compression_enabled: boolean; encryption_enabled: boolean; cron_expression: string | null;
}

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: "", retention_days: 30, retention_count: 10, retry_count: 3, cron_expression: "0 3 * * *" });

  const load = () => api<Policy[]>("/policies").then(setPolicies);
  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    await api("/policies", { method: "POST", body: JSON.stringify({ ...form, compression_enabled: true, encryption_enabled: true, cleanup_enabled: true, retry_delay_seconds: 300 }) });
    setShowForm(false);
    load();
  }

  return (
    <DashboardLayout title="Policies">
      <div className="mb-6 flex justify-end">
        <Button onClick={() => setShowForm(!showForm)}><Plus className="h-4 w-4" /> New Policy</Button>
      </div>
      {showForm && (
        <Card className="mb-6 glass">
          <CardHeader><CardTitle>Create Policy</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid gap-4 md:grid-cols-2">
              <Input placeholder="Policy name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <Input type="number" placeholder="Retention days" value={form.retention_days} onChange={(e) => setForm({ ...form, retention_days: +e.target.value })} />
              <Input type="number" placeholder="Retention count" value={form.retention_count} onChange={(e) => setForm({ ...form, retention_count: +e.target.value })} />
              <Input type="number" placeholder="Retry count" value={form.retry_count} onChange={(e) => setForm({ ...form, retry_count: +e.target.value })} />
              <Input placeholder="Cron expression" value={form.cron_expression} onChange={(e) => setForm({ ...form, cron_expression: e.target.value })} className="md:col-span-2" />
              <Button type="submit" className="md:col-span-2">Create Policy</Button>
            </form>
          </CardContent>
        </Card>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        {policies.map((p) => (
          <Card key={p.id} className="glass">
            <CardContent className="p-6">
              <div className="flex justify-between">
                <h3 className="font-semibold">{p.name}</h3>
                <Button size="sm" variant="ghost" onClick={() => api(`/policies/${p.id}`, { method: "DELETE" }).then(load)}><Trash2 className="h-3 w-3" /></Button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge>Retain {p.retention_days}d</Badge>
                <Badge>Max {p.retention_count} copies</Badge>
                <Badge>Retry {p.retry_count}x</Badge>
                {p.compression_enabled && <Badge variant="success">Compression</Badge>}
                {p.encryption_enabled && <Badge variant="success">Encryption</Badge>}
              </div>
              {p.cron_expression && <p className="mt-2 text-xs text-gray-500 font-mono">{p.cron_expression}</p>}
            </CardContent>
          </Card>
        ))}
      </div>
    </DashboardLayout>
  );
}
