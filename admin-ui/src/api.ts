// Centralized API client for the admin UI.
// Base URL and auth token are configurable via Vite env vars so the UI is not
// hardcoded to localhost and can authenticate against a secured backend.

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string) || 'http://localhost:3000';

const API_TOKEN: string | undefined = import.meta.env.VITE_API_TOKEN as string | undefined;

function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
}

/**
 * Thin fetch wrapper that prefixes the base URL and attaches the auth token.
 * Accepts a path beginning with '/'.
 */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...authHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}

export async function apiGet<T = any>(path: string): Promise<T> {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return res.json();
}

export async function apiPost<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await apiFetch(path, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status}`);
  return res.json();
}
