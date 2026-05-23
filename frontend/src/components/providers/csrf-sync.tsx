"use client";

import { useEffect } from "react";

/** Keeps document cookie in sync with localStorage so POST requests pass CSRF checks. */
export function CsrfSync() {
  useEffect(() => {
    const csrf = localStorage.getItem("csrf_token");
    if (!csrf) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `csrf_token=${encodeURIComponent(csrf)}; path=/; SameSite=Lax${secure}`;
  }, []);
  return null;
}
