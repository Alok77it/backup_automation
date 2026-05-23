const API_URL = process.env.NEXT_PUBLIC_API_URL || "/api";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function getAuthHeaders(): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("access_token");
    const orgId = localStorage.getItem("organization_id");
    const csrf = localStorage.getItem("csrf_token");
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (orgId) headers["X-Organization-Id"] = orgId;
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  return headers;
}

export async function api<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: { ...getAuthHeaders(), ...options.headers },
    credentials: "include",
  });

  if (res.status === 401 && typeof window !== "undefined") {
    const refresh = localStorage.getItem("refresh_token");
    if (refresh && !endpoint.includes("/auth/refresh")) {
      try {
        const refreshRes = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: { Authorization: `Bearer ${refresh}` },
        });
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          localStorage.setItem("access_token", data.access_token);
          localStorage.setItem("refresh_token", data.refresh_token);
          localStorage.setItem("csrf_token", data.csrf_token);
          return api<T>(endpoint, options);
        }
      } catch {
        /* fall through */
      }
    }
    localStorage.clear();
    window.location.href = "/login";
    throw new ApiError(401, "Unauthorized");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new ApiError(res.status, err.detail || "Request failed");
  }

  if (res.status === 204) return {} as T;
  return res.json();
}

export const authApi = {
  signup: (data: { email: string; password: string; full_name: string; organization_name: string }) =>
    api<AuthResponse>("/auth/signup", { method: "POST", body: JSON.stringify(data) }),
  login: (data: { email: string; password: string }) =>
    api<AuthResponse>("/auth/login", { method: "POST", body: JSON.stringify(data) }),
  forgotPassword: (email: string) =>
    api<{ message: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email }) }),
  resetPassword: (token: string, password: string) =>
    api<{ message: string }>("/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) }),
};

export interface AuthResponse {
  user: { id: string; email: string; full_name: string };
  tokens: { access_token: string; refresh_token: string; csrf_token: string };
  organization_id: string;
  role: string;
}

export interface DashboardStats {
  total_servers: number;
  active_backups: number;
  failed_jobs_24h: number;
  storage_used_bytes: number;
  storage_quota_bytes: number;
  restore_readiness_avg: number;
  ai_risk_alerts: number;
  backup_health_avg: number;
}

export function saveAuth(data: AuthResponse) {
  localStorage.setItem("access_token", data.tokens.access_token);
  localStorage.setItem("refresh_token", data.tokens.refresh_token);
  localStorage.setItem("csrf_token", data.tokens.csrf_token);
  localStorage.setItem("organization_id", data.organization_id);
  localStorage.setItem("user", JSON.stringify(data.user));
  localStorage.setItem("role", data.role);
}

export function clearAuth() {
  localStorage.removeItem("access_token");
  localStorage.removeItem("refresh_token");
  localStorage.removeItem("csrf_token");
  localStorage.removeItem("organization_id");
  localStorage.removeItem("user");
  localStorage.removeItem("role");
}

export function isAuthenticated(): boolean {
  return typeof window !== "undefined" && !!localStorage.getItem("access_token");
}
