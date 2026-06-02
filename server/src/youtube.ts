// YouTube → direct audio URL resolver, backed by the `yt-dlp` binary.
//
// We tried @distube/ytdl-core first but it can't keep up with YouTube's
// frequent player-script changes; the URLs it produced were rejected by
// YouTube with HTTP 403 because the signature deciphering had silently
// broken. `yt-dlp` updates almost daily and handles deciphering correctly,
// so we shell out to it instead.
//
// Requirements
//   - `yt-dlp` must be on PATH (winget install yt-dlp / pip install yt-dlp /
//     or the binary from https://github.com/yt-dlp/yt-dlp/releases)
//   - In Docker we install yt-dlp via apt/curl (see server/Dockerfile)

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

import type { SearchResult } from "./types.js";

// =============================================================================
// YouTube cookies (datacenter anti-bot bypass)
//
// Cloud IPs (Render, Fly, AWS, ...) trip YouTube's "Sign in to confirm you're
// not a bot" check almost immediately. Passing a real browser's cookies via
// `--cookies <file>` makes yt-dlp look like that browser, which sails through.
//
// On Render: upload your exported cookies.txt as a Secret File named
// `yt-cookies.txt` → it appears at `/etc/secrets/yt-cookies.txt` at runtime.
// On Fly / Docker: bind-mount any cookies.txt at /etc/secrets/yt-cookies.txt
// (or override the path via YT_COOKIES_PATH env var).
//
// Local dev: usually unnecessary — residential IPs aren't flagged. If you
// hit the same error locally, set YT_COOKIES_PATH=path\to\cookies.txt.
//
// The file is checked at startup; we don't try to hot-reload. Restart the
// server after replacing the cookies file.
// =============================================================================
const YT_COOKIES_PATH =
  process.env.YT_COOKIES_PATH || "/etc/secrets/yt-cookies.txt";
const COOKIES_AVAILABLE = existsSync(YT_COOKIES_PATH);
if (COOKIES_AVAILABLE) {
  console.log(`[yt-dlp] using cookies from ${YT_COOKIES_PATH}`);
} else {
  console.log(
    `[yt-dlp] no cookies at ${YT_COOKIES_PATH} — datacenter IPs may be rate-limited by YouTube`,
  );
}

function ytDlpArgs(...rest: string[]): string[] {
  const args: string[] = [];
  if (COOKIES_AVAILABLE) args.push("--cookies", YT_COOKIES_PATH);
  args.push(...rest);
  return args;
}

// Startup probe: confirm yt-dlp is actually callable. Without it, YouTube
// search AND playback silently fail per-request with a Thai error — this turns
// the #1 setup gotcha into one clear, actionable log line at boot.
export function probeYtDlp(): void {
  const proc = spawn("yt-dlp", ytDlpArgs("--version"));
  let version = "";
  proc.stdout.on("data", (c: Buffer) => (version += c.toString()));
  proc.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") {
      console.warn(
        "[yt-dlp] ⚠ NOT FOUND on PATH — YouTube search & playback will fail.\n" +
          "         Install it:  winget install yt-dlp.yt-dlp  (Windows)\n" +
          "                      brew install yt-dlp           (macOS)\n" +
          "                      pip install -U yt-dlp         (Linux)",
      );
    } else {
      console.warn(`[yt-dlp] ⚠ probe failed: ${err.message}`);
    }
  });
  proc.on("close", (code) => {
    if (code === 0) console.log(`[yt-dlp] ready (v${version.trim()})`);
  });
}

// TEMP diagnostic (remove after POT debugging): observe, from OUTSIDE, whether
// the in-container bgutil PO-token provider is up and whether yt-dlp actually
// fetches/uses a token when YouTube challenges on a datacenter IP.
export async function potDiagnostics(): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};

  // 1. Is the local bgutil provider reachable? Use curl, not Node's fetch —
  //    undici reports a bogus "fetch failed" against this server even when it's
  //    up, whereas curl (like yt-dlp's python http client) reaches it fine.
  result.providerPing = await new Promise((resolve) => {
    const proc = spawn("curl", [
      "-s",
      "-m",
      "5",
      "http://127.0.0.1:4416/ping",
    ]);
    let out = "";
    proc.stdout.on("data", (c: Buffer) => (out += c.toString()));
    proc.on("error", (e) => resolve({ error: e.message }));
    proc.on("close", (code) =>
      resolve({ exit: code, body: out.slice(0, 200) || "(empty)" }),
    );
  });

  // 2. Run a verbose resolve on a REAL, available video and surface the
  //    POT-relevant debug lines + the final ERROR (if any). This is the
  //    source of truth: does yt-dlp fetch a token from bgutil:http, and does
  //    it STILL hit the "not a bot" wall on this datacenter IP?
  result.ytdlp = await new Promise((resolve) => {
    const proc = spawn(
      "yt-dlp",
      ytDlpArgs(
        "-v",
        "--simulate",
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      ),
    );
    let err = "";
    proc.stderr.on("data", (c: Buffer) => (err += c.toString()));
    proc.stdout.on("data", () => {});
    const keep = (l: string) =>
      /pot|bgutil|Retrieved|Fetching|PO Token|GVS|Sign in to confirm|Plugin directories/i.test(
        l,
      );
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      resolve({
        timedOut: true,
        potLines: err.split(/\r?\n/).filter(keep).slice(0, 40),
      });
    }, 45000);
    proc.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve({ spawnError: e.message });
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      const errorLine =
        err
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.startsWith("ERROR:")) ?? "";
      resolve({
        exitCode: code,
        errorLine: errorLine.slice(0, 300),
        potLines: err.split(/\r?\n/).filter(keep).slice(0, 40),
      });
    });
  });

  return result;
}

export type YouTubeAudioInfo = {
  streamUrl: string;
  title: string;
  duration: number;
  thumbnail?: string;
};

const YT_HOST_REGEX = /^(www\.|m\.|music\.)?(youtube\.com|youtu\.be)$/i;

export function looksLikeYouTube(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return YT_HOST_REGEX.test(host);
  } catch {
    return false;
  }
}

const RESOLVE_TIMEOUT_MS = 30_000;

// In-memory LRU-ish cache for resolved YouTube URLs.
//   - Same URL pasted by multiple users → only one yt-dlp call
//   - Signed URLs from googlevideo last ~6h; we cache for 5min (safe margin)
//   - Coalesces concurrent requests for the same URL (in-flight Promise)
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 200;

type CacheEntry = {
  expiresAt: number;
  info: YouTubeAudioInfo;
};

const resolvedCache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<YouTubeAudioInfo>>();

function getCached(url: string): YouTubeAudioInfo | null {
  const entry = resolvedCache.get(url);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    resolvedCache.delete(url);
    return null;
  }
  // LRU bump: re-set to push to end of insertion order
  resolvedCache.delete(url);
  resolvedCache.set(url, entry);
  return entry.info;
}

function setCached(url: string, info: YouTubeAudioInfo): void {
  // Evict oldest if over capacity (Map iterates in insertion order)
  while (resolvedCache.size >= CACHE_MAX) {
    const firstKey = resolvedCache.keys().next().value;
    if (firstKey === undefined) break;
    resolvedCache.delete(firstKey);
  }
  resolvedCache.set(url, {
    expiresAt: Date.now() + CACHE_TTL_MS,
    info,
  });
}

// ============================================================================
// Search — separate cache so a popular query stays warm without crowding out
// resolved audio URLs and vice-versa. 30-min TTL since search results are
// stable for hours (titles don't change), and a single yt-dlp ytsearch run
// costs 3–8 seconds we don't want to pay twice.
// ============================================================================

const SEARCH_CACHE_TTL_MS = 30 * 60_000;
const SEARCH_CACHE_MAX = 100;
const SEARCH_TIMEOUT_MS = 30_000;

type SearchCacheEntry = { expiresAt: number; results: SearchResult[] };
const searchCache = new Map<string, SearchCacheEntry>();
const searchInFlight = new Map<string, Promise<SearchResult[]>>();

function searchKey(query: string): string {
  return query.toLowerCase().trim();
}

function getSearchCached(key: string): SearchResult[] | null {
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  searchCache.delete(key);
  searchCache.set(key, entry); // LRU bump
  return entry.results;
}

function setSearchCached(key: string, results: SearchResult[]): void {
  while (searchCache.size >= SEARCH_CACHE_MAX) {
    const k = searchCache.keys().next().value;
    if (k === undefined) break;
    searchCache.delete(k);
  }
  searchCache.set(key, {
    expiresAt: Date.now() + SEARCH_CACHE_TTL_MS,
    results,
  });
}

export async function searchYouTube(
  query: string,
  limit = 12,
): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const key = searchKey(q);
  const cached = getSearchCached(key);
  if (cached) return cached;

  const existing = searchInFlight.get(key);
  if (existing) return existing;

  const promise = runYtDlpSearch(q, limit);
  searchInFlight.set(key, promise);
  try {
    const results = await promise;
    setSearchCached(key, results);
    return results;
  } finally {
    searchInFlight.delete(key);
  }
}

function runYtDlpSearch(
  query: string,
  limit: number,
): Promise<SearchResult[]> {
  return new Promise<SearchResult[]>((resolve, reject) => {
    // `ytsearchN:query` → N results. `--flat-playlist` skips per-video
    // extraction so the call returns metadata only — ~10× faster than the
    // alternative. `-j` dumps one JSON object per line.
    const proc = spawn(
      "yt-dlp",
      ytDlpArgs(
        `ytsearch${limit}:${query}`,
        "--flat-playlist",
        "-j",
        "--no-warnings",
      ),
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch {}
      reject(new Error(`yt-dlp search ใช้เวลานานเกิน ${SEARCH_TIMEOUT_MS / 1000}s`));
    }, SEARCH_TIMEOUT_MS);

    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    proc.stderr.on("data", (c: Buffer) => (stderr += c.toString()));

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(new Error("ยังไม่ได้ติดตั้ง yt-dlp บน server"));
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        const errLine =
          stderr
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l.startsWith("ERROR:")) ?? stderr.slice(0, 300);
        reject(new Error(errLine.trim() || `yt-dlp search exit ${code}`));
        return;
      }

      const lines = stdout.split(/\r?\n/).filter((l) => l.trim());
      const results: SearchResult[] = [];
      for (const line of lines) {
        try {
          const info = JSON.parse(line) as Record<string, unknown>;
          const id = typeof info.id === "string" ? info.id : null;
          if (!id) continue;
          const title =
            typeof info.title === "string" && info.title.length > 0
              ? info.title
              : id;
          const artist =
            (typeof info.channel === "string" && info.channel) ||
            (typeof info.uploader === "string" && info.uploader) ||
            undefined;
          const duration =
            typeof info.duration === "number" ? Math.round(info.duration) : 0;
          let thumbnail: string | undefined;
          if (Array.isArray(info.thumbnails) && info.thumbnails.length > 0) {
            const last = info.thumbnails[info.thumbnails.length - 1];
            if (last && typeof last === "object" && "url" in last) {
              const u = (last as { url: unknown }).url;
              if (typeof u === "string") thumbnail = u;
            }
          }
          if (!thumbnail) {
            // Reliable fallback: YouTube always serves hqdefault for any video id
            thumbnail = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
          }
          results.push({
            id,
            source: "youtube",
            url: `https://www.youtube.com/watch?v=${id}`,
            title,
            artist,
            duration,
            thumbnail,
          });
        } catch {
          /* skip malformed line */
        }
      }
      resolve(results);
    });
  });
}

export async function resolveYouTubeAudio(
  url: string,
): Promise<YouTubeAudioInfo> {
  if (!looksLikeYouTube(url)) {
    throw new Error("ลิงก์ไม่ใช่ YouTube");
  }

  // Cache hit — instant
  const cached = getCached(url);
  if (cached) return cached;

  // Coalesce concurrent resolves of the same URL
  const existing = inFlight.get(url);
  if (existing) return existing;

  const promise = runYtDlp(url);
  inFlight.set(url, promise);
  try {
    const info = await promise;
    setCached(url, info);
    return info;
  } finally {
    inFlight.delete(url);
  }
}

function runYtDlp(url: string): Promise<YouTubeAudioInfo> {
  return new Promise<YouTubeAudioInfo>((resolve, reject) => {
    // -j        → dump JSON metadata to stdout (includes the resolved URL
    //             for the format selected by -f)
    // -f        → format selector: prefer m4a (iOS-friendly), fall back to
    //             any best audio-only, then any best with audio
    // --no-warnings / --no-playlist for clean output
    const proc = spawn(
      "yt-dlp",
      ytDlpArgs(
        "-j",
        "-f",
        "bestaudio[ext=m4a]/bestaudio/best",
        "--no-warnings",
        "--no-playlist",
        url,
      ),
    );

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        proc.kill();
      } catch {}
      reject(new Error(`yt-dlp ใช้เวลานานเกิน ${RESOLVE_TIMEOUT_MS / 1000}s`));
    }, RESOLVE_TIMEOUT_MS);

    proc.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "ยังไม่ได้ติดตั้ง yt-dlp บน server (winget install yt-dlp)",
          ),
        );
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        const errLine =
          stderr
            .split(/\r?\n/)
            .map((l) => l.trim())
            .find((l) => l.startsWith("ERROR:")) ?? stderr.slice(0, 300);
        reject(new Error(errLine.trim() || `yt-dlp exit ${code}`));
        return;
      }

      let info: Record<string, unknown>;
      try {
        info = JSON.parse(stdout);
      } catch (e) {
        reject(
          new Error(
            "yt-dlp JSON ผิดรูปแบบ: " +
              (e instanceof Error ? e.message : String(e)),
          ),
        );
        return;
      }

      const streamUrl =
        typeof info.url === "string" ? info.url : undefined;
      if (!streamUrl) {
        reject(new Error("yt-dlp ไม่คืน URL"));
        return;
      }

      const title =
        typeof info.title === "string" ? info.title : "Unknown";
      const duration =
        typeof info.duration === "number" ? Math.round(info.duration) : 0;

      // Pick the highest-quality thumbnail. yt-dlp gives `thumbnails` (array,
      // sorted lowest→highest in most cases) and a top-level `thumbnail`.
      let thumbnail: string | undefined;
      if (Array.isArray(info.thumbnails) && info.thumbnails.length > 0) {
        const last = info.thumbnails[info.thumbnails.length - 1];
        if (last && typeof last === "object" && "url" in last) {
          const u = (last as { url: unknown }).url;
          if (typeof u === "string") thumbnail = u;
        }
      }
      if (!thumbnail && typeof info.thumbnail === "string") {
        thumbnail = info.thumbnail;
      }

      resolve({ streamUrl, title, duration, thumbnail });
    });
  });
}
