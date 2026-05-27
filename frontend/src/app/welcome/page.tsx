"use client";

import { useEffect, useRef, useState } from "react";
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

/* ── nav ─────────────────────────────────────────────────────────────────── */
function Nav() {
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
        {["Platform", "Products", "Docs", "About"].map(l => (
          <a key={l} href="#" className="text-sm font-medium transition-colors"
            style={{ color: C.muted }}
            onMouseEnter={e => (e.currentTarget as HTMLAnchorElement).style.color = "#fff"}
            onMouseLeave={e => (e.currentTarget as HTMLAnchorElement).style.color = C.muted}>
            {l}
          </a>
        ))}
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
function Hero() {
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
          className="mb-6 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-medium"
          style={{ background: `${C.lime}15`, border: `1px solid ${C.lime}40`, color: C.lime }}>
          <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ background: C.lime }} />
          Now in production · Used by 200+ teams
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
          <Link href="/login"
            className="inline-flex items-center gap-2 rounded-[6px] px-7 py-3.5 text-base font-bold shadow-lg transition-all hover:scale-105"
            style={{ background: C.lime, color: C.bg, boxShadow: `0 0 30px ${C.lime}40` }}>
            Get started free →
          </Link>
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

/* ── features ────────────────────────────────────────────────────────────── */
const features = [
  { icon: "🛡️", title: "AI Backup & Recovery",    desc: "Automated backups across any server with AI-driven scheduling, compression, and one-click restore." },
  { icon: "📊", title: "Real-time Monitoring",    desc: "CPU, memory, disk, and uptime tracking with intelligent anomaly alerts before things break." },
  { icon: "🤖", title: "AI Intelligence",         desc: "Metrics-based AI recommendations. Predicts failures, suggests fixes — without touching your logs." },
  { icon: "🐳", title: "Container Management",    desc: "Deploy, inspect, start/stop Docker containers across all servers from a single dashboard." },
  { icon: "🔧", title: "DevOps Integrations",     desc: "Install Jenkins, n8n, GitHub Runners, and more on remote servers with a guided wizard." },
  { icon: "⚡", title: "Automation Scripts",      desc: "Run shell scripts, install packages, execute GitHub repos — all with approval flows and audit logs." },
];

function Features() {
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

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
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
      </div>
    </section>
  );
}

/* ── CTA band ─────────────────────────────────────────────────────────────── */
function CtaBand() {
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
            For startups & engineering teams
          </div>
          <h2 className="text-3xl md:text-5xl font-bold text-white tracking-tight mb-4">
            Built for developers<br />
            <span style={{ color: C.lime }}>who move fast</span>
          </h2>
          <p className="text-base mb-8 max-w-lg mx-auto" style={{ color: C.muted }}>
            Stop juggling five tools. Backup, monitor, automate, and deploy — from one dashboard your whole team can use.
          </p>
          <Link href="/login"
            className="inline-flex items-center gap-2 rounded-[6px] px-8 py-3.5 text-base font-bold transition-all hover:scale-105"
            style={{ background: C.lime, color: C.bg, boxShadow: `0 0 28px ${C.lime}35` }}>
            Start free today →
          </Link>
        </motion.div>
      </div>
    </section>
  );
}

/* ── reviews ──────────────────────────────────────────────────────────────── */
const reviews = [
  {
    name: "Alok Trivedi",
    role: "Founder, InfiOps",
    avatar: "AT",
    color: C.lime,
    text: "We built InfiOps because we were tired of piecing together five different tools just to know if our servers were alive. Now it's all in one place — backups running, alerts firing, containers up — and I can actually sleep at night.",
  },
  {
    name: "Shelja",
    role: "Co-founder, InfiOps",
    avatar: "SJ",
    color: C.pink,
    text: "The automation scripts feature alone saved us hours every week. Deploying packages across different Linux distros used to be a headache — now it's a one-click job with proper logs. This is how DevOps should feel.",
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
            From the people who built it
          </h2>
        </motion.div>

        <div className="grid md:grid-cols-2 gap-6">
          {reviews.map((r, i) => (
            <motion.div key={r.name}
              variants={stagger(i * 0.15)} initial="hidden" animate={inView ? "show" : "hidden"}
              className="rounded-[12px] p-8"
              style={{ background: C.mid, border: `1px solid ${C.border}` }}>
              <div className="flex text-xl mb-5" style={{ color: r.color }}>★★★★★</div>
              <p className="text-base leading-relaxed mb-6" style={{ color: C.muted }}>"{r.text}"</p>
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
              ✓ You're subscribed! Updates coming soon.
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
              AI-powered automation for modern engineering teams.
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
  return (
    <div style={{ background: C.bg, minHeight: "100vh" }}>
      <Nav />
      <Hero />
      <Features />
      <CtaBand />
      <Reviews />
      <Newsletter />
      <Footer />
    </div>
  );
}
