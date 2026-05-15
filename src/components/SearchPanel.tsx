// Browse-and-add panel.
//
// Three tabs (YouTube / Spotify / JOOX). Typing in the search bar after a
// debounce sends a `search` message to the server, which streams back a list
// of cards. Click a card → fires `onAdd(result)` which the parent uses to
// dispatch `add_track`.
//
// On first mount of the YouTube tab we auto-fire a "ฮิตวันนี้" search so
// the panel doesn't look empty when the user opens the room. Server-side
// cache means subsequent loads are instant.
//
// Spotify and JOOX are stubbed with informative panels (no server back-end
// yet — Spotify needs API credentials, JOOX has no public API at all).

import { useEffect, useRef, useState } from "react";
import type { SearchResult, SearchSource } from "../types";

const DEBOUNCE_MS = 450;

type Props = {
  /** Send the `search` WebSocket message. */
  sendSearch: (query: string, source: SearchSource) => void;
  /** Latest results received from the server. */
  results: SearchResult[];
  /** Whether the last query is still in flight. */
  searching: boolean;
  /** User picked a card — propagate to add_track. */
  onAdd: (result: SearchResult) => void;
};

const TAB_LABEL: Record<SearchSource, string> = {
  youtube: "🎬 YouTube",
  spotify: "🟢 Spotify",
  joox: "🍊 JOOX",
};

type Chip = { emoji: string; label: string; query: string };

const CHIPS: Chip[] = [
  { emoji: "⚡", label: "ฮิตวันนี้", query: "เพลงฮิต 2026" },
  { emoji: "🇹🇭", label: "ป๊อปไทย", query: "เพลงไทยฮิต 2026" },
  { emoji: "🎵", label: "ลูกทุ่ง", query: "ลูกทุ่งฮิต 2026" },
  { emoji: "🌸", label: "J-pop", query: "jpop hits 2026" },
  { emoji: "🇰🇷", label: "K-pop", query: "kpop hits 2026" },
  { emoji: "🎶", label: "Lo-fi", query: "lofi chill beats" },
  { emoji: "🎸", label: "Anime", query: "anime opening hits" },
  { emoji: "🎤", label: "Ballad", query: "เพลงรักช้าไทย ballad" },
];

function formatDuration(s: number): string {
  if (!s || !isFinite(s)) return "";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function SearchPanel({
  sendSearch,
  results,
  searching,
  onAdd,
}: Props) {
  const [tab, setTab] = useState<SearchSource>("youtube");
  const [query, setQuery] = useState("");
  const [activeChip, setActiveChip] = useState<string>(CHIPS[0].query);
  const debounceRef = useRef<number | null>(null);
  const lastSentRef = useRef<{ query: string; source: SearchSource } | null>(
    null,
  );
  const autoLoadedRef = useRef(false);

  // Debounce typing — single in-flight search per ~450 ms keystroke pause.
  useEffect(() => {
    if (tab !== "youtube") return;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    const q = query.trim();
    if (!q) return;
    debounceRef.current = window.setTimeout(() => {
      const sig = { query: q, source: tab };
      const prev = lastSentRef.current;
      if (prev && prev.query === sig.query && prev.source === sig.source) {
        return;
      }
      lastSentRef.current = sig;
      setActiveChip(""); // typed query overrides chip selection
      sendSearch(q, tab);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
      }
    };
  }, [query, tab, sendSearch]);

  // First time YouTube tab mounts: auto-fire the default chip so the panel
  // shows cards immediately. Server cache (30 min) makes this near-free on
  // subsequent room visits within the same window.
  useEffect(() => {
    if (tab !== "youtube") return;
    if (autoLoadedRef.current) return;
    if (results.length > 0) {
      autoLoadedRef.current = true;
      return;
    }
    if (searching) return;
    autoLoadedRef.current = true;
    const first = CHIPS[0];
    lastSentRef.current = { query: first.query, source: "youtube" };
    sendSearch(first.query, "youtube");
  }, [tab, results.length, searching, sendSearch]);

  function clickChip(chip: Chip) {
    setQuery("");
    setActiveChip(chip.query);
    lastSentRef.current = { query: chip.query, source: "youtube" };
    sendSearch(chip.query, "youtube");
  }

  function fireImmediately() {
    const q = query.trim();
    if (!q) return;
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const prev = lastSentRef.current;
    if (prev && prev.query === q && prev.source === "youtube") return;
    lastSentRef.current = { query: q, source: "youtube" };
    setActiveChip("");
    sendSearch(q, "youtube");
  }

  function clearInput() {
    setQuery("");
  }

  return (
    <section className="search-panel">
      <div className="search-tabs" role="tablist">
        {(["youtube", "spotify", "joox"] as SearchSource[]).map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            className={`search-tab ${tab === s ? "active" : ""}`}
            onClick={() => setTab(s)}
          >
            {TAB_LABEL[s]}
          </button>
        ))}
      </div>

      {tab === "youtube" && (
        <>
          <div className="search-input-wrap">
            <input
              className="input search-input"
              placeholder="ค้นหาเพลง / ศิลปิน / album..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") fireImmediately();
                if (e.key === "Escape") clearInput();
              }}
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                className="search-clear"
                onClick={clearInput}
                aria-label="Clear search"
                title="ล้าง"
              >
                ×
              </button>
            )}
            {searching && (
              <span className="search-spinner" aria-hidden>
                <span className="spinner spinner-sm" />
              </span>
            )}
          </div>

          <div className="chip-row" role="tablist" aria-label="หมวดเพลง">
            {CHIPS.map((c) => (
              <button
                key={c.query}
                type="button"
                className={`chip ${activeChip === c.query ? "active" : ""}`}
                onClick={() => clickChip(c)}
              >
                <span className="chip-emoji">{c.emoji}</span>
                {c.label}
              </button>
            ))}
          </div>

          {searching && results.length === 0 && (
            <div className="search-skeleton">
              <div className="card-grid">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="search-card skeleton-card">
                    <div className="card-thumb-wrap skeleton-shimmer" />
                    <div className="skeleton-line skeleton-shimmer" />
                    <div
                      className="skeleton-line skeleton-shimmer"
                      style={{ width: "60%" }}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {query.trim() && !searching && results.length === 0 && (
            <div className="muted">ไม่พบผลลัพธ์ — ลองคำอื่น</div>
          )}

          {results.length > 0 && (
            <div className="card-grid">
              {results.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="search-card"
                  onClick={() => onAdd(r)}
                  title={`เพิ่ม "${r.title}" เข้าคิว`}
                >
                  <div className="card-thumb-wrap">
                    {r.thumbnail ? (
                      <img
                        src={r.thumbnail}
                        alt=""
                        className="card-thumb"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="card-thumb card-thumb-fallback">🎵</div>
                    )}
                    {r.duration > 0 && (
                      <span className="card-duration">
                        {formatDuration(r.duration)}
                      </span>
                    )}
                    <span className="card-add-badge" aria-hidden>
                      +
                    </span>
                  </div>
                  <div className="card-title" title={r.title}>
                    {r.title}
                  </div>
                  {r.artist && (
                    <div className="card-artist" title={r.artist}>
                      {r.artist}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "spotify" && (
        <div className="search-info-box">
          <div className="search-info-emoji">🟢</div>
          <h3>Spotify search ยังไม่ได้ตั้งค่า</h3>
          <p>ต้องการ Client ID + Secret (ฟรี) เพื่อใช้ Spotify Web API</p>
          <ol>
            <li>
              สมัครฟรีที่{" "}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
              >
                developer.spotify.com/dashboard
              </a>
            </li>
            <li>สร้าง App → คัดลอก Client ID + Client Secret</li>
            <li>
              ใส่ใน <code>server/.env</code> เป็น{" "}
              <code>SPOTIFY_CLIENT_ID</code> และ{" "}
              <code>SPOTIFY_CLIENT_SECRET</code>
            </li>
            <li>Restart server</li>
          </ol>
          <p className="muted">
            หมายเหตุ: Spotify ให้แค่ metadata (title/artist/cover) — ตัวเสียงจะ
            ดึงจาก YouTube ที่ตรงกันเหมือนเดิม
          </p>
        </div>
      )}

      {tab === "joox" && (
        <div className="search-info-box">
          <div className="search-info-emoji">🍊</div>
          <h3>JOOX ไม่มี public API</h3>
          <p>
            JOOX (Tencent) ไม่เปิด API ให้ดึงเพลงจากภายนอก — ค้นหาเพลงเดียวกัน
            บน YouTube ก็เล่นได้เหมือนกัน
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => setTab("youtube")}
          >
            🎬 เปลี่ยนไปค้น YouTube
          </button>
        </div>
      )}
    </section>
  );
}
