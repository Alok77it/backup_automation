"use client";

import { useEffect, useState } from "react";
import { Plus, Trash2, Shield, Clock, RefreshCw, Edit2, X, Check } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { api, ApiError } from "@/lib/api";

interface Policy {
  id: string;
  name: string;
  retention_days: number;
  retention_count: number;
  retry_count: number;
  compression_enabled: boolean;
  encryption_enabled: boolean;
  cleanup_enabled: boolean;
  cron_expression: string | null;
}

const CRON_PRESETS = [
  { label: "Every day at 2 AM", value: "0 2 * * *" },
  { label: "Every day at midnight", value: "0 0 * * *" },
  { label: "Every 6 hours", value: "0 */6 * * *" },
  { label: "Every hour", value: "0 * * * *" },
  { label: "Weekly (Sunday 2 AM)", value: "0 2 * * 0" },
  { label: "Monthly (1st at 2 AM)", value: "0 2 1 * *" },
  { label: "Custom", value: "custom" },
];

function describeCron(expr: string | null): string {
  if (!expr) return "Manual only";
  const map: Record<string, string> = {
    "0 2 * * *": "Daily at 2:00 AM UTC",
    "0 0 * * *": "Daily at midnight UTC",
    "0 */6 * * *": "Every 6 hours",
    "0 * * * *": "Every hour",
    "0 2 * * 0": "Weekly on Sunday at 2:00 AM UTC",
    "0 2 1 * *": "Monthly on the 1st at 2:00 AM UTC",
  };
  return map[expr] || expr;
}

const emptyForm = {
  name: "",
  retention_days: 30,
  retention_count: 10,
  retry_count: 3,
  cleanup_enabled: true,
  compression_enabled: true,
  encryption_enabled: false,
  cron_expression: "0 2 * * *",
  cron_preset: "0 2 * * *",
};

export default function PoliciesPage() {
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = () =>
    api<Policy[]>("/policies")
      .then(setPolicies)
      .catch((e) => setError(e.message));

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditId(null);
    setForm({ ...emptyForm });
    setShowForm(true);
  }

  function openEdit(p: Policy) {
    setEditId(p.id);
    const preset = CRON_PRESETS.find((x) => x.value === p.cron_expression);
    setForm({
      name: p.name,
      retention_days: p.retention_days,
      retention_count: p.retention_count,
      retry_count: p.retry_count,
      cleanup_enabled: p.cleanup_enabled,
      compression_enabled: p.compression_enabled,
      encryption_enabled: p.encryption_enabled,
      cron_expression: p.cron_expression || "",
      cron_preset: preset ? preset.value : "custom",
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const payload = {
        name: form.name,
        retention_days: form.retention_days,
        retention_count: form.retention_count,
        retry_count: form.retry_count,
        cleanup_enabled: form.cleanup_enabled,
        compression_enabled: form.compression_enabled,
        encryption_enabled: form.encryption_enabled,
        retry_delay_seconds: 300,
        cron_expression: form.cron_expression || null,
      };
      if (editId) {
        await api(`/policies/${editId}`, { method: "PUT", body: JSON.stringify(payload) });
        setSuccess("Policy updated.");
      } else {
        await api("/policies", { method: "POST", body: JSON.stringify(payload) });
        setSuccess("Policy created.");
      }
      setShowForm(false);
      setEditId(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to save policy");
    } finally {
      setSubmitting(false);
    }
  }

  async function deletePolicy(id: string, name: string) {
    if (!confirm(`Delete policy "${name}"?`)) return;
    try {
      await api(`/policies/${id}`, { method: "DELETE" });
      setSuccess(`Policy "${name}" deleted.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete policy");
    }
  }

  return (
    <DashboardLayout title="Policies">
      <PageHero
        icon={Shield}
        title="Backup Policies"
        description="Define retention rules, schedules, and automation settings applied to your backup jobs"
        action={
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" /> New Policy
          </Button>
        }
      />

      <AlertBanner type="error" message={error} onClose={() => setError("")} />
      <AlertBanner type="success" message={success} onClose={() => setSuccess("")} />

      {/* Info box about how cron works */}
      <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-800">
        <strong className="block mb-1">🕐 How scheduled backups run</strong>
        Backup schedules are executed by the <strong>Celery Beat</strong> scheduler running inside your Docker stack.
        It checks every 15 minutes if any backup is due and triggers it automatically.
        No external cron agent or SSH daemon needed — just keep <code className="bg-blue-100 px-1 rounded">docker compose up</code> running.
        Schedules use UTC time.
      </div>

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="mb-6 glass border-emerald-200">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-emerald-600" />
                  {editId ? "Edit Policy" : "Create Policy"}
                </CardTitle>
                <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-5">
                  {/* Row 1: Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Policy Name <span className="text-red-500">*</span>
                    </label>
                    <Input
                      placeholder="e.g. Daily Production Backup"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">A descriptive name for this policy</p>
                  </div>

                  {/* Row 2: Retention */}
                  <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 space-y-4">
                    <p className="text-sm font-semibold text-emerald-800">🗄 Retention Settings</p>
                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Retention Period (Days)
                        </label>
                        <Input
                          type="number"
                          min={1}
                          max={3650}
                          value={form.retention_days}
                          onChange={(e) => setForm({ ...form, retention_days: +e.target.value })}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Delete backup runs older than this many days. Old runs are auto-cleaned after each backup.
                        </p>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Max Backup Copies (Count)
                        </label>
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          value={form.retention_count}
                          onChange={(e) => setForm({ ...form, retention_count: +e.target.value })}
                        />
                        <p className="text-xs text-gray-500 mt-1">
                          Keep at most this many recent backup copies. Oldest are deleted first.
                        </p>
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.cleanup_enabled}
                        onChange={(e) => setForm({ ...form, cleanup_enabled: e.target.checked })}
                        className="h-4 w-4 rounded accent-emerald-600"
                      />
                      <span className="font-medium">Auto-cleanup enabled</span>
                      <span className="text-gray-500">— automatically remove old backups per retention rules above</span>
                    </label>
                  </div>

                  {/* Row 3: Schedule */}
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-3">
                    <p className="text-sm font-semibold text-blue-800">🕐 Schedule</p>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Quick Schedule Preset</label>
                      <select
                        className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        value={form.cron_preset}
                        onChange={(e) => {
                          const val = e.target.value;
                          setForm({
                            ...form,
                            cron_preset: val,
                            cron_expression: val === "custom" ? form.cron_expression : val,
                          });
                        }}
                      >
                        {CRON_PRESETS.map((p) => (
                          <option key={p.value} value={p.value}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Cron Expression
                      </label>
                      <Input
                        placeholder="0 2 * * *  (minute hour day month weekday)"
                        value={form.cron_expression}
                        onChange={(e) => setForm({ ...form, cron_expression: e.target.value, cron_preset: "custom" })}
                        className="font-mono"
                      />
                      <p className="text-xs text-gray-500 mt-1">
                        Format: <code className="bg-gray-100 px-1 rounded">minute hour day-of-month month day-of-week</code> (UTC).
                        {form.cron_expression && (
                          <span className="ml-2 text-emerald-700 font-medium">
                            → {describeCron(form.cron_expression)}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Row 4: Retry & Options */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Retry Attempts on Failure
                      </label>
                      <Input
                        type="number"
                        min={0}
                        max={10}
                        value={form.retry_count}
                        onChange={(e) => setForm({ ...form, retry_count: +e.target.value })}
                      />
                      <p className="text-xs text-gray-500 mt-1">How many times to retry a failed backup (0 = no retry)</p>
                    </div>
                    <div className="flex flex-col gap-3 justify-center rounded-xl border border-gray-100 bg-white px-4 py-3">
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={form.compression_enabled}
                          onChange={(e) => setForm({ ...form, compression_enabled: e.target.checked })}
                          className="h-4 w-4 rounded accent-emerald-600"
                        />
                        <span className="font-medium">Compression</span>
                        <span className="text-gray-500 text-xs">— reduce backup file size</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer text-sm">
                        <input
                          type="checkbox"
                          checked={form.encryption_enabled}
                          onChange={(e) => setForm({ ...form, encryption_enabled: e.target.checked })}
                          className="h-4 w-4 rounded accent-emerald-600"
                        />
                        <span className="font-medium">Encryption</span>
                        <span className="text-gray-500 text-xs">— encrypt backup files at rest</span>
                      </label>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {submitting ? "Saving…" : editId ? "Update Policy" : "Create Policy"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {policies.length === 0 && !showForm ? (
        <div className="py-20 text-center">
          <Shield className="mx-auto h-12 w-12 text-emerald-200 mb-4" />
          <p className="text-muted-foreground">No policies yet.</p>
          <p className="text-sm text-muted-foreground mt-1">Click "New Policy" to define your first backup policy.</p>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {policies.map((p, i) => (
            <motion.div key={p.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
              <Card className="glass h-full">
                <CardContent className="p-5">
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="font-semibold text-base">{p.name}</h3>
                      {p.cron_expression && (
                        <p className="text-xs text-emerald-700 mt-0.5 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {describeCron(p.cron_expression)}
                        </p>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEdit(p)} title="Edit">
                        <Edit2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-red-400 hover:text-red-600 hover:bg-red-50"
                        onClick={() => deletePolicy(p.id, p.name)}
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Retention visual */}
                  <div className="mb-3 rounded-lg bg-emerald-50 border border-emerald-100 p-3 space-y-2">
                    <p className="text-xs font-semibold text-emerald-700 uppercase tracking-wide">Retention</p>
                    <div className="flex gap-4 text-sm">
                      <div>
                        <p className="text-2xl font-bold text-emerald-700">{p.retention_days}</p>
                        <p className="text-xs text-gray-500">days max age</p>
                      </div>
                      <div className="w-px bg-emerald-200" />
                      <div>
                        <p className="text-2xl font-bold text-emerald-700">{p.retention_count}</p>
                        <p className="text-xs text-gray-500">copies kept</p>
                      </div>
                    </div>
                  </div>

                  {/* Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    <Badge variant="default">{p.retry_count}x retry</Badge>
                    {p.compression_enabled && <Badge variant="success">Compressed</Badge>}
                    {p.encryption_enabled && <Badge variant="success">Encrypted</Badge>}
                    {p.cleanup_enabled ? (
                      <Badge variant="success">Auto-cleanup</Badge>
                    ) : (
                      <Badge variant="warning">No cleanup</Badge>
                    )}
                  </div>

                  {/* Cron expression raw */}
                  {p.cron_expression && (
                    <p className="mt-3 font-mono text-[11px] text-gray-400 bg-gray-50 rounded px-2 py-1 border border-gray-100">
                      {p.cron_expression}
                    </p>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </DashboardLayout>
  );
}
