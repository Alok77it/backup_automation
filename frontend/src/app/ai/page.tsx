"use client";

import { useEffect, useState, useRef } from "react";
import { Send, Brain, Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";

interface Message { role: string; content: string }

const SUGGESTIONS = [
  "Why did backup fail?",
  "Why are backups slow?",
  "Which server is risky?",
  "Is restore safe?",
  "How to optimize storage?",
];

export default function AIPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "I'm your Backup Intelligence AI assistant. I can analyze logs, metrics, backup history, and infrastructure events. How can I help?" },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage(text?: string) {
    const msg = text || input;
    if (!msg.trim()) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: msg }]);
    setLoading(true);
    try {
      const res = await api<{ conversation_id: string; message: string }>("/ai/chat", {
        method: "POST",
        body: JSON.stringify({ message: msg, conversation_id: conversationId }),
      });
      setConversationId(res.conversation_id);
      setMessages((m) => [...m, { role: "assistant", content: res.message }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Unable to reach AI service. Configure ANTHROPIC_API_KEY or OPENAI_API_KEY for enhanced analysis." }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <DashboardLayout title="AI Intelligence">
      <div className="flex h-[calc(100vh-12rem)] flex-col">
        <div className="mb-4 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => sendMessage(s)} className="rounded-full border border-emerald-200 px-4 py-1.5 text-sm text-[#047857] hover:bg-[#D1FAE5] transition dark:border-emerald-800">
              <Sparkles className="inline h-3 w-3 mr-1" />{s}
            </button>
          ))}
        </div>

        <Card className="flex-1 glass overflow-hidden">
          <CardContent className="flex h-full flex-col p-0">
            <div className="flex-1 overflow-y-auto p-6 space-y-4">
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                    m.role === "user"
                      ? "gradient-primary text-white"
                      : "bg-[#D1FAE5] text-gray-800 dark:bg-emerald-950 dark:text-emerald-100"
                  }`}>
                    {m.role === "assistant" && <Brain className="inline h-4 w-4 mr-2 text-[#10B981]" />}
                    <div className="whitespace-pre-wrap">{m.content}</div>
                  </div>
                </motion.div>
              ))}
              {loading && <div className="text-sm text-gray-400 animate-pulse">Analyzing infrastructure data...</div>}
              <div ref={bottomRef} />
            </div>
            <div className="border-t p-4 flex gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Ask about backups, restores, risks..."
                className="flex-1"
              />
              <Button onClick={() => sendMessage()} disabled={loading}><Send className="h-4 w-4" /></Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}
