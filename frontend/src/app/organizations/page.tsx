"use client";

import { useEffect, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

interface Member { id: string; email: string; full_name: string; role: string; joined_at: string }
interface AuditLog { id: string; action: string; resource_type: string; user_email: string | null; created_at: string }

export default function OrganizationsPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("viewer");

  useEffect(() => {
    api<Member[]>("/organizations/members").then(setMembers);
    api<AuditLog[]>("/organizations/audit-logs").then(setAudit).catch(() => {});
  }, []);

  async function invite() {
    await api("/organizations/invitations", { method: "POST", body: JSON.stringify({ email: inviteEmail, role: inviteRole }) });
    setInviteEmail("");
  }

  return (
    <DashboardLayout title="Organizations">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="glass">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" /> Members</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex gap-2">
              <Input placeholder="Email to invite" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
              <select className="h-10 rounded-xl border px-2" value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
                {["viewer", "operator", "admin"].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <Button onClick={invite}><UserPlus className="h-4 w-4" /></Button>
            </div>
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between border-b py-3 last:border-0">
                <div>
                  <p className="font-medium">{m.full_name}</p>
                  <p className="text-xs text-gray-500">{m.email}</p>
                </div>
                <Badge>{m.role}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="glass">
          <CardHeader><CardTitle>Audit Logs</CardTitle></CardHeader>
          <CardContent className="max-h-96 overflow-y-auto">
            {audit.map((a) => (
              <div key={a.id} className="border-b py-2 last:border-0 text-sm">
                <p className="font-medium">{a.action}</p>
                <p className="text-xs text-gray-500">{a.user_email} · {a.resource_type} · {new Date(a.created_at).toLocaleString()}</p>
              </div>
            ))}
            {audit.length === 0 && <p className="text-gray-500 text-sm">No audit logs</p>}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
