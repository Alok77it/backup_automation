"use client";

import { useEffect, useState } from "react";
import { UserPlus, Users, Trash2, Building2, RefreshCw, X, Check, Shield } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { PageHero } from "@/components/ui/page-hero";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AlertBanner } from "@/components/ui/alert-banner";
import { api, ApiError } from "@/lib/api";

interface Member {
  id: string; user_id: string; email: string; full_name: string;
  role: string; joined_at: string;
}
interface AuditLog {
  id: string; action: string; resource_type: string;
  user_email: string | null; created_at: string;
}

const ROLES = ["viewer", "operator", "admin"];

const roleColors: Record<string, string> = {
  owner: "bg-purple-100 text-purple-800",
  admin: "bg-red-100 text-red-800",
  operator: "bg-blue-100 text-blue-800",
  viewer: "bg-gray-100 text-gray-700",
};

export default function OrganizationsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    email: "", full_name: "", password: "", role: "viewer",
  });
  const [showPass, setShowPass] = useState(false);

  const load = () => {
    api<Member[]>("/organizations/members").then(setMembers).catch(() => {});
    api<AuditLog[]>("/organizations/audit-logs").then(setAudit).catch(() => {});
  };

  useEffect(() => { load(); }, []);

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await api("/organizations/users", {
        method: "POST",
        body: JSON.stringify(form),
      });
      setSuccess(`User "${form.email}" created and added to organization.`);
      setShowForm(false);
      setForm({ email: "", full_name: "", password: "", role: "viewer" });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to create user");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeMember(userId: string, email: string) {
    if (!confirm(`Remove "${email}" from this organization?`)) return;
    try {
      await api(`/organizations/members/${userId}`, { method: "DELETE" });
      setSuccess(`${email} removed.`);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to remove member");
    }
  }

  return (
    <DashboardLayout title="Organizations">
      <PageHero
        icon={Building2}
        title="Organization"
        description="Manage team members, roles, and review activity logs"
        action={
          <Button onClick={() => setShowForm(!showForm)}>
            <UserPlus className="h-4 w-4" /> Add User
          </Button>
        }
      />

      <AlertBanner type="error" message={error} onClose={() => setError("")} />
      <AlertBanner type="success" message={success} onClose={() => setSuccess("")} />

      <AnimatePresence>
        {showForm && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="mb-6 glass border-emerald-200">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-emerald-600" /> Create New User
                </CardTitle>
                <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <form onSubmit={createUser} className="grid gap-4 md:grid-cols-2">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                    <Input
                      placeholder="John Doe"
                      value={form.full_name}
                      onChange={(e) => setForm({ ...form, full_name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address *</label>
                    <Input
                      type="email"
                      placeholder="john@company.com"
                      value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                    <div className="relative">
                      <Input
                        type={showPass ? "text" : "password"}
                        placeholder="Minimum 8 characters"
                        value={form.password}
                        onChange={(e) => setForm({ ...form, password: e.target.value })}
                        required
                        minLength={8}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400 hover:text-gray-600"
                      >
                        {showPass ? "hide" : "show"}
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">Share this securely with the user — they can change it in Settings</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                    <select
                      className="w-full h-10 rounded-xl border border-gray-200 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      viewer = read only · operator = run backups · admin = full access
                    </p>
                  </div>
                  <div className="md:col-span-2 flex gap-3 pt-1">
                    <Button type="submit" disabled={submitting}>
                      {submitting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {submitting ? "Creating…" : "Create User & Add to Org"}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Members list */}
        <Card className="glass">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" /> Team Members
              <span className="text-sm font-normal text-gray-500">({members.length})</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {members.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-6">No members yet</p>
            ) : (
              <div className="space-y-2">
                {members.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3 hover:bg-gray-50 transition"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-semibold text-sm">
                        {m.full_name?.charAt(0)?.toUpperCase() || m.email.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-sm">{m.full_name}</p>
                        <p className="text-xs text-gray-500">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${roleColors[m.role] || roleColors.viewer}`}>
                        {m.role}
                      </span>
                      {m.role !== "owner" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-red-400 hover:text-red-600 hover:bg-red-50"
                          onClick={() => removeMember(m.user_id, m.email)}
                          title="Remove member"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}

            {/* Role legend */}
            <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-3">
              <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1">
                <Shield className="h-3.5 w-3.5" /> Role permissions
              </p>
              <div className="space-y-1 text-xs text-gray-600">
                <p><span className={`inline-block rounded-full px-2 py-0.5 mr-2 font-semibold ${roleColors.viewer}`}>viewer</span>Read-only access to all data</p>
                <p><span className={`inline-block rounded-full px-2 py-0.5 mr-2 font-semibold ${roleColors.operator}`}>operator</span>View + trigger backups and restores</p>
                <p><span className={`inline-block rounded-full px-2 py-0.5 mr-2 font-semibold ${roleColors.admin}`}>admin</span>Full access — manage servers, policies, users</p>
                <p><span className={`inline-block rounded-full px-2 py-0.5 mr-2 font-semibold ${roleColors.owner}`}>owner</span>Organization owner — cannot be removed</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Audit logs */}
        <Card className="glass">
          <CardHeader><CardTitle>Audit Logs</CardTitle></CardHeader>
          <CardContent className="max-h-[500px] overflow-y-auto">
            {audit.length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-6">No audit logs</p>
            ) : (
              <div className="space-y-1">
                {audit.map((a) => (
                  <div key={a.id} className="rounded-lg border border-gray-50 bg-gray-50/80 px-3 py-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-gray-800">{a.action}</span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {new Date(a.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {a.user_email || "system"} · {a.resource_type}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
