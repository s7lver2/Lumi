import * as dns from "node:dns/promises";

const MAX_DOWNLOAD_BYTES = 10 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;

export type FetchImageUrlResult = { ok: true; bytes: Buffer } | { ok: false; reason: string };

function isPrivateOrReservedIp(address: string): boolean {
  // Unwrap IPv4-mapped IPv6 addresses (e.g. "::ffff:127.0.0.1") so the
  // embedded IPv4 address is checked against the ranges below instead of
  // silently passing through unmatched.
  const v4Mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const check = v4Mapped ? v4Mapped[1] : address;

  // IPv4 ranges
  if (/^10\./.test(check)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(check)) return true;
  if (/^192\.168\./.test(check)) return true;
  if (/^127\./.test(check)) return true;
  if (/^169\.254\./.test(check)) return true;
  if (/^0\./.test(check)) return true; // 0.0.0.0/8 - treated as localhost by the kernel on Linux
  // IPv6 ranges
  if (check === "::1") return true;
  if (/^f[cd][0-9a-f]{2}:/i.test(check)) return true; // fc00::/7
  if (/^fe[89ab][0-9a-f]:/i.test(check)) return true; // fe80::/10
  return false;
}

/**
 * Downloads an image from a user-supplied URL with SSRF protections:
 * http(s)-only, DNS-resolved before connecting (rejecting private/
 * reserved ranges — including the 169.254.169.254 cloud metadata
 * address), a hard timeout, and a real byte-counted download cap (never
 * trusts Content-Length, which can lie). Callers MUST still run the
 * result through validateImageBytes (image-validation.ts) — a URL can
 * serve non-image bytes with a spoofed Content-Type.
 */
export async function fetchImageUrl(url: string): Promise<FetchImageUrlResult> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: "Enlace no válido" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { ok: false, reason: "Solo se permiten enlaces http o https" };
  }

  try {
    // Known limitation (DNS-rebinding TOCTOU): we validate the IP here via
    // dns.lookup(), but fetch() below resolves the hostname again on its own,
    // so a DNS record with a very short TTL could theoretically resolve to a
    // different (private) IP between the two lookups. A fully correct fix
    // requires pinning the actual TCP connection to this already-validated
    // IP (e.g. a custom undici Agent/dispatcher), which also complicates
    // HTTPS SNI/certificate validation. Deliberately not doing that here —
    // this is a self-hosted, single-operator tool, not multi-tenant SaaS,
    // so the risk is accepted for now rather than building that follow-up.
    const { address } = await dns.lookup(parsed.hostname);
    if (isPrivateOrReservedIp(address)) {
      return { ok: false, reason: "El enlace apunta a una dirección no permitida" };
    }
  } catch {
    return { ok: false, reason: "No se pudo resolver el dominio del enlace" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(parsed.toString(), { signal: controller.signal, redirect: "error" });
    if (!res.ok || !res.body) {
      return { ok: false, reason: "No se pudo descargar el enlace" };
    }

    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.length;
        if (total > MAX_DOWNLOAD_BYTES) {
          return { ok: false, reason: "La imagen supera el tamaño máximo permitido (10MB)" };
        }
        chunks.push(value);
      }
    }

    return { ok: true, bytes: Buffer.concat(chunks.map((c) => Buffer.from(c))) };
  } catch {
    return { ok: false, reason: "No se pudo descargar el enlace a tiempo" };
  } finally {
    clearTimeout(timeout);
  }
}
