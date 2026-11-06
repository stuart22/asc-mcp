import { gunzipSync } from "node:zlib";
import type { Doc } from "./types.ts";

/** The only host this server ever talks to. */
export const ASC_BASE_URL = "https://api.appstoreconnect.apple.com";

export type Query = Record<string, string | number | boolean | undefined>;

export class AscApiError extends Error {
  override name = "AscApiError";
  /** HTTP status, or 0 when Apple couldn't be reached. */
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export type AscClientOptions = {
  tokens: { getToken(): Promise<string> };
  fetch?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Read-only App Store Connect client. Its only public methods are `get` and
 * `getText`, both of which send GET, so nothing built on it can change data.
 * It never logs, and its errors never contain the token or request headers.
 */
export class AscClient {
  readonly #tokens: AscClientOptions["tokens"];
  readonly #fetch: typeof fetch;
  readonly #timeoutMs: number;

  constructor(opts: AscClientOptions) {
    this.#tokens = opts.tokens;
    this.#fetch = opts.fetch ?? globalThis.fetch;
    this.#timeoutMs = opts.timeoutMs ?? 30_000;
  }

  async get<A = Record<string, unknown>>(path: string, query: Query = {}): Promise<Doc<A>> {
    const res = await this.#request(path, query, "application/json");
    return (await res.json()) as Doc<A>;
  }

  /** Reads a non-JSON response (CSV, gzipped TSV, Apple JSON media types) as UTF-8 text. */
  async getText(path: string, query: Query, accept: string): Promise<string> {
    const res = await this.#request(path, query, accept);
    const bytes = Buffer.from(await res.arrayBuffer());
    // Decide by the gzip magic bytes, not the content type: the body may already have been decoded in transit.
    const gzipped = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
    return (gzipped ? gunzipSync(bytes) : bytes).toString("utf8");
  }

  async #request(path: string, query: Query, accept: string): Promise<Response> {
    if (!/^\/v\d+\/[A-Za-z0-9/_-]+$/.test(path) || path.includes("..")) {
      throw new Error(`Refusing to request an unexpected API path.`);
    }
    const url = new URL(path, ASC_BASE_URL);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }

    const token = await this.#tokens.getToken();
    let res: Response;
    try {
      res = await this.#fetch(url, {
        method: "GET",
        headers: { authorization: `Bearer ${token}`, accept },
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new AscApiError(
        0,
        timedOut
          ? "App Store Connect didn't respond in time (timed out). Try again in a moment."
          : "Couldn't reach App Store Connect. Check your internet connection or VPN.",
      );
    }

    if (!res.ok) {
      throw new AscApiError(res.status, scrub(describeError(res.status, await appleDetail(res)), token));
    }
    return res;
  }
}

/** Cursor for the next page, taken from Apple's `links.next`. */
export function nextCursor(doc: Doc<unknown>): string | undefined {
  const next = doc.links?.next;
  if (!next) return undefined;
  try {
    return new URL(next, ASC_BASE_URL).searchParams.get("cursor") ?? undefined;
  } catch {
    return undefined;
  }
}

async function appleDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { errors?: Array<{ title?: string; detail?: string }> };
    const first = body.errors?.[0];
    return [first?.title, first?.detail].filter(Boolean).join(": ").slice(0, 500);
  } catch {
    return "";
  }
}

function describeError(status: number, detail: string): string {
  const apple = detail ? ` Apple said: ${detail}` : "";
  switch (status) {
    case 401:
      return `App Store Connect rejected the API key (401). Check ASC_KEY_ID, ASC_ISSUER_ID (team keys only — leave unset for an individual key), and that the stored key matches and hasn't been revoked.${apple}`;
    case 403:
      return `Your API key isn't allowed to see this (403). Your App Store Connect role or app access may not include it.${apple}`;
    case 404:
      return `Not found in App Store Connect (404).${apple}`;
    case 429:
      return `App Store Connect rate limit reached (429). Wait a minute and try again.${apple}`;
    default:
      return `App Store Connect returned an error (${status}).${apple}`;
  }
}

/** Belt and braces: never let the token appear in a message, even if Apple echoes it. */
function scrub(message: string, token: string): string {
  return token ? message.split(token).join("[redacted]") : message;
}
