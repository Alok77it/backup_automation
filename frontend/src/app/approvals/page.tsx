"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, ShieldX, Clock, AlertTriangle } from "lucide-react";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";

interface ApprovalRequest {
  id: string;
  requested_by: string;
  reviewed_by: string | null;
  title: string;
  description: string | null;
  action_type: string;
  risk_level: string;
  server_id: string | null;
  status: string;
  review_note: string | null;
  expires_at: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<"pending" | "all">("pending");

  const loadApprovals = () => {
    setLoading(true);
    const url = filter === "pending"
      ? "/approvals?status_filter=pending&limit=50"
      : "/approvals?limit=50";
    api<ApprovalRequest[]>(url)
      .then(setApprovals)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadApprovals(); }, [filter]);

  const decide = async (id: string, action: "approve" | "reject") => {
    setProcessing(true);
    setError(null);
    try {
      await api(`/approvals/${id}/${action}`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      setSelectedId(null);
      setNote("");
      loadApprovals();
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  const riskIcon = (level: string) => {
    if (level === "high") return <AlertTriangle className="h-4 w-4 text-red-500" />;
    if (level === "medium") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <ShieldCheck className="h-4 w-4 text-green-500" />;
  };

  const statusBadge = (status: string) => {
    const map: Record<string, "outline" | "secondary" | "destructive"> = {
      pending: "secondary",
      approved: "outline",
      rejected: "destructive",
      expired: "destructive",
    };
    return <Badge variant={map[status] ?? "outline"}>{status}</Badge>;
  };

  return (
    <DashboardLayout title="Approval Queue">
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-3xl font-bold">Approval Queue</h1>
          <p className="text-muted-foreground mt-1">
            HIGH-risk actions require explicit approval before execution
          </p>
        </div>

        {error && (
          <div className="rounded border border-destructive bg-destructive/10 p-4 text-destructive text-sm">{error}</div>
        )}

        <div className="flex gap-2">
          {(["pending", "all"] as const).map((f) => (
            <Button
              key={f}
              size="sm"
              variant={filter === f ? "default" : "outline"}
              onClick={() => setFilter(f)}
            >
              {f === "pending" ? <Clock className="h-4 w-4 mr-1" /> : null}
              {f === "pending" ? "Pending" : "All"}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="text-muted-foreground text-sm">Loading…</div>
        ) : approvals.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              <ShieldCheck className="h-10 w-10 mx-auto mb-3 text-green-500/50" />
              <div className="font-medium">No pending approvals</div>
              <div className="text-sm mt-1">All HIGH-risk actions are up to date.</div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {approvals.map((approval) => (
              <Card key={approval.id} className="overflow-hidden">
                <div
                  className={`h-1 ${approval.risk_level === "high" ? "bg-red-500" : approval.risk_level === "medium" ? "bg-yellow-500" : "bg-green-500"}`}
                />
                <CardContent className="pt-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {riskIcon(approval.risk_level)}
                        <span className="font-semibold truncate">{approval.title}</span>
                        {statusBadge(approval.status)}
                      </div>
                      <div className="text-sm text-muted-foreground mb-1">
                        Action: <code className="bg-muted px-1 rounded text-xs">{approval.action_type}</code>
                      </div>
                      {approval.description && (
                        <div className="text-xs text-muted-foreground line-clamp-2">{approval.description}</div>
                      )}
                      <div className="text-xs text-muted-foreground mt-2">
                        Requested: {new Date(approval.created_at).toLocaleString()}
                        {approval.expires_at && ` · Expires: ${new Date(approval.expires_at).toLocaleString()}`}
                      </div>
                    </div>

                    {approval.status === "pending" && (
                      <div className="shrink-0">
                        {selectedId === approval.id ? (
                          <div className="space-y-2 w-72">
                            <Textarea
                              placeholder="Review note (optional)…"
                              value={note}
                              onChange={(e) => setNote(e.target.value)}
                              rows={2}
                              className="text-sm"
                            />
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                className="flex-1 bg-green-600 hover:bg-green-700"
                                onClick={() => decide(approval.id, "approve")}
                                disabled={processing}
                              >
                                <ShieldCheck className="h-4 w-4 mr-1" /> Approve
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                className="flex-1"
                                onClick={() => decide(approval.id, "reject")}
                                disabled={processing}
                              >
                                <ShieldX className="h-4 w-4 mr-1" /> Reject
                              </Button>
                            </div>
                            <Button variant="ghost" size="sm" className="w-full" onClick={() => setSelectedId(null)}>
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" onClick={() => setSelectedId(approval.id)}>
                            Review
                          </Button>
                        )}
                      </div>
                    )}

                    {approval.status !== "pending" && approval.review_note && (
                      <div className="shrink-0 max-w-xs text-xs text-muted-foreground italic">
                        "{approval.review_note}"
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
