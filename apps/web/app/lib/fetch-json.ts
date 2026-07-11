// apps/web/app/lib/fetch-json.ts
"use client";

export interface FetchJsonResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
}

/**
 * fetch + safe JSON parse. Never throws on an empty or non-JSON body — an
 * empty 500 (a server route that threw) or an HTML error page comes back as
 * `data: null` instead of a `SyntaxError: unexpected end of data` that would
 * surface as an unhandled runtime error. Callers branch on `ok`.
 */
export async function fetchJson<T = any>(
  input: string,
  init?: RequestInit
): Promise<FetchJsonResult<T>> {
  const res = await fetch(input, init);
  const text = await res.text();
  let data: T | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  return { ok: res.ok, status: res.status, data };
}
