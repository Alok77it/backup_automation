"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, useSpring, AnimatePresence, type Variants } from "framer-motion";
import Link from "next/link";

/* ── tiny helpers ─────────────────────────────────────────────────────────── */
function useMouse() {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useEffect(() => {
    const h = (e: MouseEvent) => setPos({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", h);
    return () => window.removeEventListener("mousemove", h);
  }, []);
  return pos;
}

function useInView(threshold = 0.15) {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold });
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return { ref, inView };
}

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 32 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

const stagger = (delay = 0): Variants => ({
  hidden: { opacity: 0, y: 24 },
  show:   { opacity: 1, y: 0, transition: { duration: 0.55, delay, ease: "easeOut" } },
});

/* ── colour tokens ────────────────────────────────────────────────────────── */
const C = {
  bg:      "#150f23",
  mid:     "#1f1633",
  surface: "#2d2540",
  border:  "#362d59",
  lime:    "#c2ef4e",
  violet:  "#6a5fc1",
  pink:    "#fa7faa",
  muted:   "#bdb8c0",
  faint:   "#3f3849",
} as const;

/* ── floating orb ────────────────────────────────────────────────────────── */
function Orb({ x, y, color, size, blur }: { x: string; y: string; color: string; size: number; blur: number }) {
  return (
    <div className="pointer-events-none absolute rounded-full"
      style={{ left: x, top: y, width: size, height: size,
        background: color, filter: `blur(${blur}px)`, opacity: 0.18, transform: "translate(-50%,-50%)" }} />
  );
}

/* ── grid dots ───────────────────────────────────────────────────────────── */
function GridDots() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="1" fill={C.border} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#dots)" />
      </svg>
    </div>
  );
}

/* ── animated globe ──────────────────────────────────────────────────────── */
function Globe() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const rotRef    = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const R = 130; // globe radius
    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;

    function project(lat: number, lon: number, rot: number) {
      const phi   = (lat * Math.PI) / 180;
      const theta = ((lon + rot) * Math.PI) / 180;
      const x = R * Math.cos(phi) * Math.sin(theta);
      const y = R * Math.sin(phi);
      const z = R * Math.cos(phi) * Math.cos(theta);
      return { x: cx + x, y: cy - y, z };
    }

    function drawLatitude(lat: number, rot: number, alpha: number) {
      ctx!.beginPath();
      let first = true;
      for (let lon = -180; lon <= 180; lon += 3) {
        const p = project(lat, lon, rot);
        if (p.z < 0) { first = true; continue; }
        if (first) { ctx!.moveTo(p.x, p.y); first = false; }
        else ctx!.lineTo(p.x, p.y);
      }
      ctx!.strokeStyle = `rgba(98,87,193,${alpha})`;
      ctx!.lineWidth = 0.6;
      ctx!.stroke();
    }

    function drawLongitude(lon: number, rot: number, alpha: number) {
      ctx!.beginPath();
      let first = true;
      for (let lat = -80; lat <= 80; lat += 3) {
        const p = project(lat, lon, rot);
        if (p.z < 0) { first = true; continue; }
        if (first) { ctx!.moveTo(p.x, p.y); first = false; }
        else ctx!.lineTo(p.x, p.y);
      }
      ctx!.strokeStyle = `rgba(98,87,193,${alpha})`;
      ctx!.lineWidth = 0.6;
      ctx!.stroke();
    }

    // Glowing dots on globe surface
    const dots: { lat: number; lon: number; color: string; size: number }[] = [
      { lat: 40,  lon: -74,  color: C.lime,   size: 3 },
      { lat: 51,  lon: 0,    color: C.pink,   size: 2.5 },
      { lat: 35,  lon: 139,  color: C.lime,   size: 2.5 },
      { lat: -34, lon: 151,  color: C.violet, size: 2 },
      { lat: 28,  lon: 77,   color: C.lime,   size: 2.5 },
      { lat: 1,   lon: 103,  color: C.pink,   size: 2 },
      { lat: 48,  lon: 2,    color: C.lime,   size: 2 },
      { lat: 37,  lon: -122, color: C.pink,   size: 3 },
      { lat: 55,  lon: 37,   color: C.violet, size: 2 },
      { lat: -23, lon: -46,  color: C.lime,   size: 2 },
    ];

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Sphere glow
      const grd = ctx!.createRadialGradient(cx, cy, 0, cx, cy, R);
      grd.addColorStop(0, "rgba(106,95,193,0.08)");
      grd.addColorStop(0.7, "rgba(106,95,193,0.04)");
      grd.addColorStop(1, "transparent");
      ctx!.beginPath();
      ctx!.arc(cx, cy, R, 0, Math.PI * 2);
      ctx!.fillStyle = grd;
      ctx!.fill();

      // Outer ring
      ctx!.beginPath();
      ctx!.arc(cx, cy, R, 0, Math.PI * 2);
      ctx!.strokeStyle = "rgba(98,87,193,0.35)";
      ctx!.lineWidth = 1;
      ctx!.stroke();

      const rot = rotRef.current;

      // Latitude lines
      for (let lat = -60; lat <= 60; lat += 20) {
        drawLatitude(lat, rot, 0.3);
      }
      // Longitude lines
      for (let lon = 0; lon < 360; lon += 20) {
        drawLongitude(lon, rot, 0.3);
      }

      // Dots
      for (const d of dots) {
        const p = project(d.lat, d.lon, rot);
        if (p.z < 0) continue;
        const fade = (p.z / R) * 0.8 + 0.2;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, d.size, 0, Math.PI * 2);
        ctx!.fillStyle = d.color;
        ctx!.globalAlpha = fade;
        ctx!.fill();

        // Pulse ring
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, d.size + 3 + Math.sin(Date.now() / 600 + d.lat) * 1.5, 0, Math.PI * 2);
        ctx!.strokeStyle = d.color;
        ctx!.lineWidth = 0.8;
        ctx!.globalAlpha = fade * 0.3;
        ctx!.stroke();
        ctx!.globalAlpha = 1;
      }

      rotRef.current += 0.12;
      animRef.current = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  return (
    <canvas ref={canvasRef} width={300} height={300}
      className="pointer-events-none select-none"
      style={{ opacity: 0.85 }} />
  );
}

/* ── product modal ───────────────────────────────────────────────────────── */
interface RegisterForm {
  organization_name: string;
  full_name: string;
  email: string;
  password: string;
}

function ProductModal({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<"details" | "register" | "success">("details");
  const [form, setForm] = useState<RegisterForm>({ organization_name: "", full_name: "", email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const field = (key: keyof RegisterForm, label: string, type = "text", placeholder = "") => (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-mono uppercase tracking-widest"
        style={{ color: C.muted }}>{label}</label>
      <input
        type={type}
        required
        placeholder={placeholder}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        className="w-full rounded-[5px] border bg-[#150f23] px-3 py-2.5 text-sm text-white placeholder:text-[#3f3849] focus:outline-none focus:ring-1 focus:ring-[#c2ef4e] focus:border-[#c2ef4e]"
        style={{ borderColor: C.border }}
      />
    </div>
  );

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/welcome-register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Registration failed. Please try again.");
      }
      setStep("success");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const tools = [
    { icon: "🛡️", label: "AI Backup" },
    { icon: "📊", label: "Monitoring" },
    { icon: "🤖", label: "AI Engine" },
    { icon: "🐳", label: "Containers" },
    { icon: "🔧", label: "DevOps Tools" },
    { icon: "⚡", label: "Automation" },
  ];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ background: "rgba(10,6,20,0.85)", backdropFilter: "blur(8px)" }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 20 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="relative w-full max-w-lg rounded-[16px] overflow-hidden"
        style={{ background: C.mid, border: `1px solid ${C.border}` }}>

        {/* Close button */}
        <button onClick={onClose}
          className="absolute top-4 right-4 z-10 flex h-7 w-7 items-center justify-center rounded-full text-sm transition-all"
          style={{ background: C.surface, color: C.muted }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = "#fff"}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = C.muted}>
          ✕
        </button>

        {step === "details" && (
          <div className="p-8">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-[8px]"
                style={{ background: C.lime }}>
                <span className="text-sm font-bold" style={{ color: C.bg }}>io</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">InfiOps Platform</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: C.pink }} />
                  <span className="text-xs font-mono" style={{ color: C.pink }}>Coming Soon · Beta</span>
                </div>
              </div>
            </div>

            <p className="text-sm mb-6 leading-relaxed" style={{ color: C.muted }}>
              A unified platform for AI-powered backup, real-time monitoring, container management,
              and DevOps automation — built for startups and engineering teams.
            </p>

            {/* Tool grid */}
            <div className="grid grid-cols-3 gap-2.5 mb-6">
              {tools.map(t => (
                <div key={t.label} className="flex items-center gap-2 rounded-[7px] px-3 py-2.5"
                  style={{ background: C.surface, border: `1px solid ${C.border}` }}>
                  <span className="text-base">{t.icon}</span>
                  <span className="text-xs font-medium" style={{ color: C.muted }}>{t.label}</span>
                </div>
              ))}
            </div>

            {/* Globe + stats */}
            <div className="flex items-center justify-between rounded-[10px] px-4 py-3 mb-6"
              style={{ background: C.bg, border: `1px solid ${C.border}` }}>
              <div className="space-y-1">
                <p className="text-xs font-mono" style={{ color: C.faint }}>Launch status</p>
                <p className="text-sm font-semibold" style={{ color: C.lime }}>Early Access · Q3 2026</p>
                <p className="text-xs" style={{ color: C.muted }}>Be first to get access</p>
              </div>
              <div className="flex gap-4">
                <div className="text-center">
                  <p className="text-lg font-bold text-white">6</p>
                  <p className="text-[10px] font-mono" style={{ color: C.faint }}>Modules</p>
                </div>
                <div className="text-center">
                  <p className="text-lg font-bold text-white">∞</p>
                  <p className="text-[10px] font-mono" style={{ color: C.faint }}>Servers</p>
                </div>
              </div>
            </div>

            <button onClick={() => setStep("register")}
              className="w-full rounded-[6px] py-3 text-sm font-bold transition-all hover:scale-[1.02]"
              style={{ background: C.lime, color: C.bg, boxShadow: `0 0 20px ${C.lime}35` }}>
              Register for Early Access →
            </button>
          </div>
        )}

        {step === "register" && (
          <div className="p-8">
            <div className="flex items-center gap-2 mb-6">
              <button onClick={() => setStep("details")}
                className="text-sm transition-colors"
                style={{ color: C.faint }}
                onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = C.muted}
                onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = C.faint}>
                ← Back
              </button>
              <span className="text-sm font-semibold text-white">Create your account</span>
            </div>

            <form onSubmit={handleRegister} className="space-y-4">
              {field("organization_name", "Organization / Company Name", "text", "Acme Inc.")}
              {field("full_name", "Full Name", "text", "Your name")}
              {field("email", "Work Email", "email", "you@company.com")}
              {field("password", "Password", "password", "Min. 8 characters")}

              {error && (
                <div className="rounded-[5px] px-3 py-2 text-xs"
                  style={{ background: "rgba(240,70,70,0.1)", border: "1px solid rgba(240,70,70,0.3)", color: "#f78080" }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                className="w-full rounded-[6px] py-3 text-sm font-bold transition-all disabled:opacity-60 hover:scale-[1.02]"
                style={{ background: C.lime, color: C.bg, boxShadow: `0 0 20px ${C.lime}30` }}>
                {loading ? "Creating account…" : "Create Account & Register →"}
              </button>

              <p className="text-center text-[11px]" style={{ color: C.faint }}>
                Your credentials will work on the platform when it launches.
              </p>
            </form>
          </div>
        )}

        {step === "success" && (
          <div className="p-10 text-center">
            <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", duration: 0.5 }}
              className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full text-2xl"
              style={{ background: `${C.lime}20`, border: `2px solid ${C.lime}60` }}>
              ✓
            </motion.div>
            <h3 className="text-xl font-bold text-white mb-3">You&apos;re on the list!</h3>
            <p className="text-sm leading-relaxed mb-6" style={{ color: C.muted }}>
              Your InfiOps account has been created. We&apos;ll send you an email with updates and
              your access details when we launch. Stay tuned!
            </p>
            <div className="rounded-[8px] px-4 py-3 mb-6 text-sm"
              style={{ background: C.surface, border: `1px solid ${C.border}`, color: C.muted }}>
              📧 Check your inbox — a welcome email is on its way.
            </div>
            <button onClick={onClose}
              className="rounded-[6px] px-6 py-2.5 text-sm font-semibold transition-all hover:scale-105"
              style={{ background: C.lime, color: C.bg }}>
              Done
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

/* ── nav ─────────────────────────────────────────────────────────────────── */
function Nav({ onOpenModal }: { onOpenModal: () => void }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const h = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", h);
    return () => window.removeEventListener("scroll", h);
  }, []);

  return (
    <motion.nav initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-12 h-16 transition-all"
      style={{
        background: scrolled ? "rgba(21,15,35,0.92)" : "transparent",
        borderBottom: scrolled ? `1px solid ${C.border}` : "none",
        backdropFilter: scrolled ? "blur(16px)" : "none",
      }}>
      {/* Logo */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-[6px]"
          style={{ background: C.lime }}>
          <span className="text-sm font-bold" style={{ color: C.bg }}>io</span>
        </div>
        <span className="text-lg font-bold text-white tracking-tight">InfiOps</span>
      </div>

      {/* Links */}
      <div className="hidden md:flex items-center gap-8">
        {[["Platform", "#features"], ["Products", "#"]].map(([l, h]) => (
          <a key={l} href={h} className="text-sm font-medium transition-colors"
            style={{ color: C.muted }}
            onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = "#fff"}
            onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = C.muted}>
            {l}
          </a>
        ))}
        <button onClick={onOpenModal}
          className="text-sm font-medium transition-colors"
          style={{ color: C.lime, background: "none", border: "none", cursor: "pointer" }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = "#d4f76a"}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = C.lime}>
          Early Access ✦
        </button>
      </div>

      <Link href="/login"
        className="inline-flex items-center gap-2 rounded-[5px] px-4 py-2 text-sm font-semibold transition-all"
        style={{ background: C.lime, color: C.bg }}
        onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = "#d4f76a"}
        onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = C.lime}>
        Sign in →
      </Link>
    </motion.nav>
  );
}

/* ── hero ────────────────────────────────────────────────────────────────── */
function Hero({ onOpenModal }: { onOpenModal: () => void }) {
  const mouse = useMouse();
  const px = useSpring(0, { stiffness: 60, damping: 20 });
  const py = useSpring(0, { stiffness: 60, damping: 20 });

  useEffect(() => {
    if (typeof window === "undefined") return;
    px.set((mouse.x - window.innerWidth / 2) * 0.015);
    py.set((mouse.y - window.innerHeight / 2) * 0.015);
  }, [mouse, px, py]);

  const words = ["Automate.", "Monitor.", "Recover.", "Deploy."];
  const [wordIdx, setWordIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setWordIdx(i => (i + 1) % words.length), 2200);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-16"
      style={{ background: C.bg }}>
      <GridDots />
      <Orb x="20%" y="30%" color={C.violet} size={600} blur={90} />
      <Orb x="80%" y="60%" color={C.lime}   size={500} blur={100} />
      <Orb x="50%" y="10%" color={C.pink}   size={400} blur={80} />

      {/* floating cards — mouse parallax */}
      <motion.div style={{ x: px, y: py }} className="absolute inset-0 pointer-events-none">
        {/* top-right floating card */}
        <motion.div className="absolute right-16 top-28 hidden lg:block"
          animate={{ y: [0, -10, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}>
          <div className="rounded-[8px] px-4 py-3 text-xs font-mono w-52"
            style={{ background: C.mid, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="h-2 w-2 rounded-full" style={{ background: "#4dc771" }} />
              <span style={{ color: C.muted }}>backup-job-042</span>
            </div>
            <div style={{ color: C.lime }}>✓ Completed in 1.2s</div>
            <div className="mt-1" style={{ color: C.faint }}>3 servers · 12 GB archived</div>
          </div>
        </motion.div>

        {/* bottom-left floating card */}
        <motion.div className="absolute left-16 bottom-36 hidden lg:block"
          animate={{ y: [0, 10, 0] }} transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}>
          <div className="rounded-[8px] px-4 py-3 text-xs font-mono w-56"
            style={{ background: C.mid, border: `1px solid ${C.border}` }}>
            <div className="flex items-center gap-2 mb-2">
              <span className="h-2 w-2 rounded-full" style={{ background: C.lime }} />
              <span style={{ color: C.muted }}>ai-analysis</span>
            </div>
            <div style={{ color: "#bdb8c0" }}>Anomaly detected on</div>
            <div style={{ color: C.pink }}>server-prod-02 · disk 92%</div>
          </div>
        </motion.div>

        {/* right-mid floating pill */}
        <motion.div className="absolute right-24 bottom-48 hidden lg:block"
          animate={{ y: [0, -8, 0] }} transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}>
          <div className="rounded-full px-4 py-2 text-xs font-semibold"
            style={{ background: C.lime, color: C.bg }}>
            🐳 Container deployed
          </div>
        </motion.div>
      </motion.div>

      {/* Main content */}
      <div className="relative z-10 flex flex-col items-center text-center px-6 max-w-5xl">
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium cursor-pointer select-none"
          style={{ background: `${C.pink}15`, border: `1px solid ${C.pink}40`, color: C.pink }}
          onClick={onOpenModal}>
          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: C.pink }} />
          Coming Soon · Beta Registration Open ✦
        </motion.div>

        <motion.h1 className="text-5xl md:text-7xl lg:text-8xl font-bold text-white leading-[1.05] tracking-tight"
          initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.1 }}>
          One platform to
          <br />
          <span style={{ color: C.lime }}>
            <AnimatePresence mode="wait">
              <motion.span key={wordIdx}
                initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.4 }}
                className="inline-block">
                {words[wordIdx]}
              </motion.span>
            </AnimatePresence>
          </span>
        </motion.h1>

        <motion.p className="mt-6 text-lg md:text-xl max-w-2xl leading-relaxed"
          style={{ color: C.muted }}
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.25 }}>
          InfiOps brings together AI-powered backup, real-time monitoring, container management,
          and DevOps automation — so your team ships faster and sleeps better.
        </motion.p>

        <motion.div className="mt-10 flex flex-wrap items-center justify-center gap-4"
          initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}>
          <button onClick={onOpenModal}
            className="inline-flex items-center gap-2 rounded-[6px] px-7 py-3.5 text-base font-bold shadow-lg transition-all hover:scale-105"
            style={{ background: C.lime, color: C.bg, boxShadow: `0 0 30px ${C.lime}40` }}>
            Register for Early Access →
          </button>
          <a href="#features"
            className="inline-flex items-center gap-2 rounded-[6px] px-7 py-3.5 text-base font-semibold transition-all border"
            style={{ background: "transparent", color: "#fff", borderColor: C.border }}
            onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.background = C.surface}
            onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.background = "transparent"}>
            See the platform
          </a>
        </motion.div>

        {/* scroll indicator */}
        <motion.div className="mt-20 flex flex-col items-center gap-2"
          animate={{ y: [0, 6, 0] }} transition={{ duration: 2, repeat: Infinity }}>
          <span className="text-xs" style={{ color: C.faint }}>Scroll</span>
          <div className="h-8 w-px" style={{ background: `linear-gradient(to bottom, ${C.border}, transparent)` }} />
        </motion.div>
      </div>
    </section>
  );
}

/* ── services strip ──────────────────────────────────────────────────────── */
const services = [
  { icon: "🤖", title: "AI Automation Tools",  desc: "We build intelligent automation solutions — from backup pipelines to workflow orchestration — tailored for startups and growing engineering teams." },
  { icon: "🌐", title: "Web Development",      desc: "Full-stack web applications, SaaS products, and custom platforms. Clean code, fast delivery, scalable architecture." },
  { icon: "⚙️", title: "DevOps & Infrastructure", desc: "CI/CD pipelines, cloud setup, container orchestration, and monitoring. We make your infrastructure boring — in the best way possible." },
];

function Services() {
  const { ref, inView } = useInView();
  return (
    <section className="relative py-20 px-6 overflow-hidden" ref={ref}
      style={{ background: C.mid, borderTop: `1px solid ${C.border}` }}>
      <div className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(ellipse 70% 50% at 20% 50%, ${C.violet}12, transparent)` }} />
      <div className="relative z-10 max-w-6xl mx-auto">
        <motion.div className="text-center mb-12"
          variants={fadeUp} initial="hidden" animate={inView ? "show" : "hidden"}>
          <p className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: C.violet }}>
            What we do
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-white tracking-tight">
            AI automation &amp; web development
          </h2>
          <p className="mt-3 text-base max-w-xl mx-auto" style={{ color: C.muted }}>
            InfiOps is a technology company building automation tools and web products for modern teams.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-5">
          {services.map((s, i) => (
            <motion.div key={s.title}
              variants={stagger(i * 0.1)} initial="hidden" animate={inView ? "show" : "hidden"}
              className="rounded-[10px] p-6"
              style={{ background: C.bg, border: `1px solid ${C.border}` }}>
              <div className="text-3xl mb-4">{s.icon}</div>
              <h3 className="text-base font-semibold text-white mb-2">{s.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{s.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── features ────────────────────────────────────────────────────────────── */
const features = [
  { icon: "🛡️", title: "AI Backup & Recovery",    desc: "Automated backups across any server with AI-driven scheduling, compression, and one-click restore." },
  { icon: "📊", title: "Real-time Monitoring",    desc: "CPU, memory, disk, and uptime tracking with intelligent anomaly alerts before things break." },
  { icon: "🤖", title: "AI Intelligence",         desc: "Metrics-based AI recommendations. Predicts failures, suggests fixes — without touching your logs." },
  { icon: "🐳", title: "Container Management",    desc: "Deploy, inspect, start/stop Docker containers across all servers from a single dashboard." },
  { icon: "🔧", title: "DevOps Integrations",     desc: "Install Jenkins, n8n, GitHub Runners, and more on remote servers with a guided wizard." },
  { icon: "⚡", title: "Automation Scripts",      desc: "Run shell scripts, install packages, execute GitHub repos — all with approval flows and audit logs." },
];

function Features({ onOpenModal }: { onOpenModal: () => void }) {
  const { ref, inView } = useInView();
  return (
    <section id="features" className="relative py-28 px-6 overflow-hidden" style={{ background: C.bg }} ref={ref}>
      <GridDots />
      <div className="relative z-10 max-w-6xl mx-auto">
        <motion.div className="text-center mb-16"
          variants={fadeUp} initial="hidden" animate={inView ? "show" : "hidden"}>
          <p className="text-xs font-mono uppercase tracking-widest mb-4" style={{ color: C.lime }}>
            Everything you need
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
            One platform, infinite ops
          </h2>
          <p className="mt-4 text-lg max-w-xl mx-auto" style={{ color: C.muted }}>
            From backup to deployment, monitoring to automation — all connected, all visible.
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mb-12">
          {features.map((f, i) => (
            <motion.div key={f.title}
              variants={stagger(i * 0.08)} initial="hidden" animate={inView ? "show" : "hidden"}
              whileHover={{ y: -4, transition: { duration: 0.2 } }}
              className="group rounded-[10px] p-6 cursor-default transition-all"
              style={{ background: C.mid, border: `1px solid ${C.border}` }}
              onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.borderColor = `${C.lime}50`}
              onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.borderColor = C.border}>
              <div className="text-3xl mb-4">{f.icon}</div>
              <h3 className="text-base font-semibold text-white mb-2">{f.title}</h3>
              <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{f.desc}</p>
            </motion.div>
          ))}
        </div>

        {/* Globe + CTA */}
        <motion.div
          variants={fadeUp} initial="hidden" animate={inView ? "show" : "hidden"}
          className="flex flex-col md:flex-row items-center gap-10 rounded-[16px] p-8 md:p-10"
          style={{ background: C.mid, border: `1px solid ${C.border}` }}>
          <div className="flex-shrink-0 flex items-center justify-center">
            <Globe />
          </div>
          <div className="flex-1 text-center md:text-left">
            <div className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-mono mb-4"
              style={{ background: `${C.pink}15`, border: `1px solid ${C.pink}30`, color: C.pink }}>
              Coming soon · Q3 2026
            </div>
            <h3 className="text-2xl md:text-3xl font-bold text-white mb-3">
              Be first in line
            </h3>
            <p className="text-sm leading-relaxed mb-6" style={{ color: C.muted }}>
              The platform is in final stages. Register now to get early access, lock in your
              credentials, and be notified the moment we launch.
            </p>
            <button onClick={onOpenModal}
              className="inline-flex items-center gap-2 rounded-[6px] px-6 py-3 text-sm font-bold transition-all hover:scale-105"
              style={{ background: C.lime, color: C.bg, boxShadow: `0 0 20px ${C.lime}30` }}>
              Register for Early Access →
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

/* ── CTA band ─────────────────────────────────────────────────────────────── */
function CtaBand({ onOpenModal }: { onOpenModal: () => void }) {
  const { ref, inView } = useInView();
  return (
    <section className="py-20 px-6 relative overflow-hidden" style={{ background: C.mid }} ref={ref}>
      <div className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(ellipse 80% 60% at 50% 50%, ${C.violet}20, transparent)` }} />
      <div className="relative z-10 max-w-4xl mx-auto">
        <motion.div className="rounded-[16px] p-10 md:p-14 text-center"
          style={{ background: C.bg, border: `1px solid ${C.border}` }}
          variants={fadeUp} initial="hidden" animate={inView ? "show" : "hidden"}>
          <div className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-mono mb-6"
            style={{ background: `${C.lime}12`, border: `1px solid ${C.lime}30`, color: C.lime }}>
            For startups &amp; engineering teams
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight mb-4">
            Built for developers<br />
            <span style={{ color: C.lime }}>who move fast</span>
          </h2>
          <p className="text-base mb-8 max-w-lg mx-auto" style={{ color: C.muted }}>
            Stop juggling five tools. Backup, monitor, automate, and deploy — from one dashboard your whole team can use.
          </p>
          <button onClick={onOpenModal}
            className="inline-flex items-center gap-2 rounded-[6px] px-8 py-3.5 text-base font-bold transition-all hover:scale-105"
            style={{ background: C.lime, color: C.bg, boxShadow: `0 0 28px ${C.lime}35` }}>
            Register for Early Access →
          </button>
        </motion.div>
      </div>
    </section>
  );
}

/* ── reviews ──────────────────────────────────────────────────────────────── */
const reviews = [
  {
    name: "Rohan Mehta",
    role: "DevOps Lead",
    avatar: "RM",
    color: C.lime,
    text: "InfiOps brought our backups, alerts, monitoring, and containers into one clean dashboard. The team can see what is running, what needs attention, and act quickly without switching between tools.",
  },
  {
    name: "Priya Sharma",
    role: "Platform Engineer",
    avatar: "PS",
    color: C.pink,
    text: "The automation workflow saves us hours every week. Deploying packages across different Linux servers is now a guided process with approvals, logs, and clear status tracking.",
  },
];

function Reviews() {
  const { ref, inView } = useInView();
  return (
    <section className="py-28 px-6" style={{ background: C.bg }} ref={ref}>
      <div className="max-w-5xl mx-auto">
        <motion.div className="text-center mb-16"
          variants={fadeUp} initial="hidden" animate={inView ? "show" : "hidden"}>
          <p className="text-xs font-mono uppercase tracking-widest mb-3" style={{ color: C.muted }}>
            Loved by developers worldwide
          </p>
          <h2 className="text-4xl md:text-5xl font-bold text-white tracking-tight">
            What teams are saying
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6">
          {reviews.map((r, i) => (
            <motion.div key={r.name}
              variants={stagger(i * 0.15)} initial="hidden" animate={inView ? "show" : "hidden"}
              className="rounded-[12px] p-8"
              style={{ background: C.mid, border: `1px solid ${C.border}` }}>
              <div className="flex text-xl mb-5" style={{ color: r.color }}>★★★★★</div>
              <p className="text-base leading-relaxed mb-6" style={{ color: C.muted }}>&ldquo;{r.text}&rdquo;</p>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-[6px] text-sm font-bold"
                  style={{ background: r.color, color: C.bg }}>
                  {r.avatar}
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">{r.name}</p>
                  <p className="text-xs" style={{ color: C.faint }}>{r.role}</p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── newsletter ───────────────────────────────────────────────────────────── */
function Newsletter() {
  const { ref, inView } = useInView();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  return (
    <section className="py-24 px-6 relative overflow-hidden" style={{ background: C.mid }} ref={ref}>
      <div className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(ellipse 60% 80% at 80% 50%, ${C.lime}10, transparent)` }} />
      <div className="relative z-10 max-w-2xl mx-auto text-center">
        <motion.div variants={fadeUp} initial="hidden" animate={inView ? "show" : "hidden"}>
          <p className="text-xs font-mono uppercase tracking-widest mb-4" style={{ color: C.lime }}>
            Monthly Product Updates
          </p>
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4 tracking-tight">
            Stay in the loop
          </h2>
          <p className="text-base mb-8" style={{ color: C.muted }}>
            New features, improvements, and automation tips — delivered to your inbox once a month.
            No spam, ever.
          </p>

          {sent ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
              className="inline-flex items-center gap-2 rounded-[6px] px-6 py-3 text-sm font-semibold"
              style={{ background: `${C.lime}15`, border: `1px solid ${C.lime}40`, color: C.lime }}>
              ✓ You&apos;re subscribed! Updates coming soon.
            </motion.div>
          ) : (
            <form onSubmit={e => { e.preventDefault(); if (email) setSent(true); }}
              className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
              <input type="email" required placeholder="you@company.com" value={email}
                onChange={e => setEmail(e.target.value)}
                className="flex-1 rounded-[5px] border bg-[#150f23] px-4 py-3 text-sm text-white placeholder:text-[#3f3849] focus:outline-none focus:ring-1 focus:ring-[#c2ef4e]"
                style={{ borderColor: "#362d59" }} />
              <button type="submit"
                className="rounded-[5px] px-6 py-3 text-sm font-bold transition-all hover:scale-105"
                style={{ background: C.lime, color: C.bg }}>
                Subscribe
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </section>
  );
}

/* ── footer ───────────────────────────────────────────────────────────────── */
function Footer() {
  const socials = [
    { label: "GitHub",   icon: "⌥", href: "#" },
    { label: "Twitter",  icon: "𝕏", href: "#" },
    { label: "LinkedIn", icon: "in", href: "#" },
    { label: "Discord",  icon: "◈", href: "#" },
  ];

  const links = {
    "Platform":  ["Backups", "Monitoring", "Containers", "AI Engine", "DevOps Tools"],
    "Company":   ["About", "Blog", "Careers", "Contact"],
    "Legal":     ["Privacy", "Terms", "Security"],
  };

  return (
    <footer className="border-t px-6 py-16" style={{ background: C.bg, borderColor: C.border }}>
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-10 mb-12">
          {/* Brand */}
          <div>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-[6px]"
                style={{ background: C.lime }}>
                <span className="text-sm font-bold" style={{ color: C.bg }}>io</span>
              </div>
              <span className="text-base font-bold text-white">InfiOps</span>
            </div>
            <p className="text-sm leading-relaxed mb-6" style={{ color: C.muted }}>
              AI automation tools &amp; web development for modern engineering teams.
            </p>
            <div className="flex items-center gap-3">
              {socials.map(s => (
                <a key={s.label} href={s.href} title={s.label}
                  className="flex h-8 w-8 items-center justify-center rounded-[5px] text-xs font-bold transition-all"
                  style={{ background: C.surface, color: C.muted, border: `1px solid ${C.border}` }}
                  onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.color = "#fff"; (e.currentTarget as HTMLAnchorElement).style.borderColor = C.lime; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.color = C.muted; (e.currentTarget as HTMLAnchorElement).style.borderColor = C.border; }}>
                  {s.icon}
                </a>
              ))}
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(links).map(([col, items]) => (
            <div key={col}>
              <p className="text-[11px] font-mono uppercase tracking-widest mb-4" style={{ color: C.faint }}>{col}</p>
              <ul className="space-y-2.5">
                {items.map(item => (
                  <li key={item}>
                    <a href="#" className="text-sm transition-colors" style={{ color: C.muted }}
                      onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = "#fff"}
                      onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = C.muted}>
                      {item}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-8"
          style={{ borderTop: `1px solid ${C.border}` }}>
          <p className="text-xs" style={{ color: C.faint }}>
            © 2026 InfiOps Technologies Pvt. Ltd. All rights reserved.
          </p>
          <p className="text-xs" style={{ color: C.faint }}>
            Built with ❤ for developers worldwide
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */
export default function WelcomePage() {
  const [modalOpen, setModalOpen] = useState(false);
  const openModal  = useCallback(() => setModalOpen(true),  []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  return (
    <div style={{ background: C.bg, minHeight: "100vh" }}>
      <Nav onOpenModal={openModal} />
      <Hero onOpenModal={openModal} />
      <Services />
      <Features onOpenModal={openModal} />
      <CtaBand onOpenModal={openModal} />
      <Reviews />
      <Newsletter />
      <Footer />

      <AnimatePresence>
        {modalOpen && <ProductModal onClose={closeModal} />}
      </AnimatePresence>
    </div>
  );
}
