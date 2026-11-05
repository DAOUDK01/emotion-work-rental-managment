/** Typed API client: cookie auth, CSRF header, one automatic refresh on 401. */

const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)emf_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => setTimeout(() => (refreshing = null), 100));
  return refreshing;
}

async function request<T>(method: string, path: string, body?: unknown, retry = true): Promise<T> {
  const isForm = body instanceof FormData;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    credentials: 'include',
    headers: {
      ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRF-Token': csrfToken() } : {}),
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/login')) {
    if (await tryRefresh()) return request<T>(method, path, body, false);
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    let code = 'HTTP_' + res.status;
    let message = res.statusText;
    let details: unknown;
    if (contentType.includes('application/json')) {
      const data = (await res.json().catch(() => null)) as {
        error?: { code?: string; message?: string; details?: unknown };
      } | null;
      if (data?.error) {
        code = data.error.code ?? code;
        message = data.error.message ?? message;
        details = data.error.details;
      }
    }
    throw new ApiError(res.status, code, message, details);
  }
  if (contentType.includes('application/json')) return (await res.json()) as T;
  return (await res.blob()) as unknown as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  del: <T>(path: string, body?: unknown) => request<T>('DELETE', path, body),
};

/** Open a file endpoint (PDF/XLSX) in a new tab / trigger download. */
export async function downloadFile(path: string, fileName?: string): Promise<void> {
  const blob = await request<Blob>('GET', path);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  if (fileName) a.download = fileName;
  else a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
