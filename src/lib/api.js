import { authHeadersForPath } from "./session.js";

export const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:4100" : window.location.origin);

export async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(authHeadersForPath(path) || {}),
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return response.json();
}
