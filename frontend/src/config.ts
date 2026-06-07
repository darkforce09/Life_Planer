// Centralized client config for the Face widget.
// Override at build/run time with the EXPO_PUBLIC_API_URL env var.

export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000';

const API_TOKEN: string | undefined = process.env.EXPO_PUBLIC_API_TOKEN;

export function authHeaders(): Record<string, string> {
  return API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {};
}

/** fetch wrapper that prefixes the API base URL and attaches the auth token. */
export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = {
    ...(init.body ? { 'Content-Type': 'application/json' } : {}),
    ...authHeaders(),
    ...(init.headers as Record<string, string> | undefined),
  };
  return fetch(`${API_BASE_URL}${path}`, { ...init, headers });
}
