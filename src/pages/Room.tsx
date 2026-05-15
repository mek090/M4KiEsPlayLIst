import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  RoomState,
  SearchResult,
  SearchSource,
  TrackKind,
} from "../types";
import { RoomClient, type ConnectionStatus } from "../ws";
import AudioPlayer from "../components/AudioPlayer";
import SearchPanel from "../components/SearchPanel";
import { useToasts } from "../components/Toast";

type Props = {
  roomId: string;
  onLeave: () => void;
};

const NAME_STORAGE_KEY = "m4kies.name";
// Server takes ~1–3s for a fresh YouTube URL, faster on cache hit. Clear the
// pending UI after this so a server hiccup doesn't leave the spinner stuck.
const PENDING_TIMEOUT_MS = 15_000;

function detectKind(url: string): TrackKind | null {
  const u = url.trim();
  if (/(?:youtube\.com\/watch|youtu\.be\/|youtube\.com\/shorts)/.test(u)) {
    return "youtube";
  }
  if (/\.(mp3|ogg|wav|flac|m4a|aac|opus|webm)(?:\?|$)/i.test(u)) {
    return "audio";
  }
  return null;
}

/** Deterministic pastel gradient from a participant name. */
function avatarStyle(name: string): React.CSSProperties {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hue} 70% 68%), hsl(${(hue + 45) % 360} 70% 72%))`,
  };
}

export default function Room({ roomId, onLeave }: Props) {
  const toast = useToasts();
  const [name, setName] = useState<string>(
    () => localStorage.getItem(NAME_STORAGE_KEY) ?? "",
  );
  const [nameSet, setNameSet] = useState<boolean>(
    () => !!localStorage.getItem(NAME_STORAGE_KEY),
  );
  const [room, setRoom] = useState<RoomState | null>(null);
  const [stateArrivedAt, setStateArrivedAt] = useState<number>(Date.now());
  const [urlInput, setUrlInput] = useState("");
  // Audio context unlocked by a user gesture. Required on iOS/Safari before
  // any media element will start playback. Once set, all subsequent track
  // changes can autoplay in this session.
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [connStatus, setConnStatus] = useState<ConnectionStatus>("connecting");
  const [pending, setPending] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const lastSearchRef = useRef<{ query: string; source: SearchSource } | null>(
    null,
  );
  const pendingTimerRef = useRef<number | null>(null);
  const lastTrackCountRef = useRef(0);
  const clientRef = useRef<RoomClient | null>(null);

  useEffect(() => {
    if (!nameSet || !name.trim()) return;
    const client = new RoomClient();
    clientRef.current = client;
    const unsubState = client.onState((s, arrivedAt) => {
      // Any state update with a new track count = our pending add landed
      // (or someone else added — close enough, server is fast).
      if (s.tracks.length > lastTrackCountRef.current) {
        setPending(false);
        if (pendingTimerRef.current !== null) {
          window.clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
      }
      lastTrackCountRef.current = s.tracks.length;
      setRoom(s);
      setStateArrivedAt(arrivedAt);
    });
    const unsubErr = client.onError((msg) => {
      toast.show(`⚠ ${msg}`, "error");
      setPending(false);
      setSearching(false);
    });
    const unsubStatus = client.onStatus(setConnStatus);
    const unsubSearch = client.onSearchResults(({ query, source, results }) => {
      // Ignore stale results that don't match the current outstanding query
      const last = lastSearchRef.current;
      if (last && (last.query !== query || last.source !== source)) return;
      setSearchResults(results);
      setSearching(false);
    });
    client.connect(roomId, name.trim());
    return () => {
      unsubState();
      unsubErr();
      unsubStatus();
      unsubSearch();
      client.close();
      clientRef.current = null;
      if (pendingTimerRef.current !== null) {
        window.clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }
    };
  }, [nameSet, name, roomId, toast]);

  const client = clientRef.current;
  const currentTrack = useMemo(() => {
    if (!room || room.currentIdx < 0) return null;
    return room.tracks[room.currentIdx] ?? null;
  }, [room]);

  function addTrack() {
    const url = urlInput.trim();
    if (!url || !client) return;
    const kind = detectKind(url);
    if (!kind) {
      toast.show(
        "URL นี้ไม่รองรับ — ใช้ YouTube หรือ direct audio (.mp3 ฯลฯ)",
        "error",
      );
      return;
    }
    const title =
      kind === "youtube"
        ? "กำลังโหลด..."
        : (url.split("/").pop()?.split("?")[0] ?? url);
    client.send({ type: "add_track", track: { url, title, kind } });
    setUrlInput("");
    setPending(true);
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
    }
    pendingTimerRef.current = window.setTimeout(() => {
      setPending(false);
      pendingTimerRef.current = null;
    }, PENDING_TIMEOUT_MS);
  }

  function saveName() {
    const trimmed = name.trim();
    if (trimmed.length < 1) return;
    localStorage.setItem(NAME_STORAGE_KEY, trimmed);
    setNameSet(true);
  }

  function unlockAudio() {
    setAudioUnlocked(true);
    // If the room is paused, tap-to-start should also resume playback for the
    // whole room (democracy). If it's already playing, this is a no-op.
    if (room && !room.playing && currentTrack) {
      client?.send({ type: "play" });
    }
  }

  const sendSearch = useCallback(
    (query: string, source: SearchSource) => {
      if (!clientRef.current) return;
      lastSearchRef.current = { query, source };
      setSearching(true);
      setSearchResults([]);
      clientRef.current.send({ type: "search", query, source });
    },
    [],
  );

  function addFromSearch(r: SearchResult) {
    if (!clientRef.current) return;
    clientRef.current.send({
      type: "add_track",
      track: {
        url: r.url,
        title: r.title,
        kind: r.source === "youtube" ? "youtube" : "audio",
        thumbnail: r.thumbnail,
        duration: r.duration,
      },
    });
    setPending(true);
    if (pendingTimerRef.current !== null) {
      window.clearTimeout(pendingTimerRef.current);
    }
    pendingTimerRef.current = window.setTimeout(() => {
      setPending(false);
      pendingTimerRef.current = null;
    }, PENDING_TIMEOUT_MS);
    toast.show(`เพิ่ม "${r.title.slice(0, 40)}..." เข้าคิวแล้ว`, "success");
  }

  async function shareRoom() {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: "M4KiEs Room", url });
      } catch {
        /* user dismissed */
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.show("📋 คัดลอกลิงก์แล้ว ส่งให้เพื่อนได้เลย ♡", "success");
    } catch {
      prompt("คัดลอกลิงก์นี้:", url);
    }
  }

  // === Name gate ===
  if (!nameSet) {
    return (
      <div className="home">
        <div className="home-card">
          <h1 className="home-title">🎀 ใส่ชื่อก่อนเข้าห้อง</h1>
          <p className="home-subtitle">
            ห้อง <code>{roomId}</code>
          </p>
          <input
            className="input"
            placeholder="ชื่อของคุณ (เพื่อนๆ เห็น)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveName()}
            maxLength={32}
            autoFocus
          />
          <button className="btn btn-primary btn-large" onClick={saveName}>
            🍡 เข้าห้อง
          </button>
        </div>
      </div>
    );
  }

  // === Connecting (waiting for first state) ===
  if (!room) {
    return (
      <div className="home">
        <div className="home-card">
          <h1 className="home-title">🎀 เชื่อมต่อ...</h1>
          <p className="home-subtitle">
            ห้อง <code>{roomId}</code>
          </p>
          <div className="conn-badge conn-connecting">
            <span className="conn-dot" /> กำลังเชื่อม WebSocket...
          </div>
        </div>
      </div>
    );
  }

  // Status badge label/class
  const statusLabel: Record<ConnectionStatus, string> = {
    connecting: "กำลังเชื่อม...",
    open: "ออนไลน์",
    reconnecting: "หลุด — กำลังต่อใหม่...",
    closed: "ปิด",
  };

  // === Main room UI ===
  return (
    <div className="room">
      {/* Blurred backdrop using the current track's thumbnail. Hidden if no
          thumbnail. Sits behind everything via z-index. */}
      {currentTrack?.thumbnail && (
        <div
          className="room-backdrop"
          style={{ backgroundImage: `url(${currentTrack.thumbnail})` }}
          aria-hidden
        />
      )}

      <header className="room-header">
        <div>
          <div className="room-code-label">
            รหัสห้อง
            <span className={`conn-badge conn-${connStatus}`}>
              <span className="conn-dot" />
              {statusLabel[connStatus]}
            </span>
          </div>
          <h1 className="room-code">{roomId}</h1>
        </div>
        <div className="room-header-actions">
          <button className="btn btn-ghost" onClick={shareRoom}>
            📋 แชร์
          </button>
          <button className="btn btn-ghost" onClick={onLeave}>
            🚪 ออก
          </button>
        </div>
      </header>

      <div className="player-area">
        {currentTrack ? (
          <div className="player-wrap">
            <AudioPlayer
              key={currentTrack.id}
              url={currentTrack.url}
              title={currentTrack.title}
              thumbnail={currentTrack.thumbnail}
              addedBy={currentTrack.addedBy}
              playing={room.playing}
              position={room.position}
              serverNow={room.serverNow}
              positionUpdatedAt={room.positionUpdatedAt}
              stateArrivedAt={stateArrivedAt}
              enabled={audioUnlocked}
              onPlayPause={(playing) =>
                client?.send({ type: playing ? "play" : "pause" })
              }
              onSeek={(pos) => client?.send({ type: "seek", position: pos })}
              onEnded={() => client?.send({ type: "skip" })}
              onSkip={() => client?.send({ type: "skip" })}
              onError={(msg) => toast.show(msg, "error")}
            />
            {!audioUnlocked && (
              <button
                type="button"
                className="unlock-overlay"
                onClick={unlockAudio}
              >
                <div className="unlock-emoji">🍡</div>
                <div className="unlock-text">แตะเพื่อเริ่มฟัง</div>
                <div className="unlock-hint">
                  (iPhone/Safari ต้องแตะก่อนเล่นเสียงได้)
                </div>
              </button>
            )}
          </div>
        ) : (
          <div className="empty-player">
            <div className="empty-emoji">🍙</div>
            <p>คิวว่าง — เพิ่มเพลงด้านล่างเลย</p>
          </div>
        )}
      </div>

      <div className="add-track">
        <input
          className="input"
          placeholder="วาง URL ที่นี่ (YouTube / .mp3 / ฯลฯ)"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTrack()}
          disabled={pending}
        />
        <button
          className="btn btn-primary"
          onClick={addTrack}
          disabled={!urlInput.trim() || pending}
        >
          {pending ? (
            <span className="btn-with-spinner">
              <span className="spinner spinner-sm" /> กำลังโหลด...
            </span>
          ) : (
            "+ เพิ่ม"
          )}
        </button>
      </div>

      <SearchPanel
        sendSearch={sendSearch}
        results={searchResults}
        searching={searching}
        onAdd={addFromSearch}
      />

      <div className="columns">
        <section className="queue-section">
          <h2 className="section-title">🎵 คิว ({room.tracks.length})</h2>
          {room.tracks.length === 0 && !pending ? (
            <div className="muted">ยังไม่มีเพลงในคิว</div>
          ) : (
            <ol className="queue-list">
              {room.tracks.map((t, i) => (
                <li
                  key={t.id}
                  className={`queue-item ${i === room.currentIdx ? "current" : ""}`}
                >
                  <div className="queue-num">{i + 1}</div>
                  <div className="queue-info">
                    <div className="queue-title">{t.title}</div>
                    <div className="queue-meta">
                      {t.kind === "youtube" ? "🎬" : "🎵"} · {t.addedBy}
                    </div>
                  </div>
                  <div className="queue-actions">
                    {i !== room.currentIdx && (
                      <button
                        className="btn btn-ghost btn-icon"
                        onClick={() =>
                          client?.send({ type: "select", index: i })
                        }
                        title="เล่นเพลงนี้"
                      >
                        ▶
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-icon"
                      onClick={() =>
                        client?.send({ type: "remove_track", trackId: t.id })
                      }
                      title="ลบออก"
                    >
                      ✕
                    </button>
                  </div>
                </li>
              ))}
              {pending && (
                <li className="queue-item queue-item-pending">
                  <div className="queue-num">
                    <span className="spinner spinner-sm" />
                  </div>
                  <div className="queue-info">
                    <div className="queue-title">กำลังดึงเพลงจาก server...</div>
                    <div className="queue-meta">⏳ · {name}</div>
                  </div>
                </li>
              )}
            </ol>
          )}
        </section>

        <section className="participants-section">
          <h2 className="section-title">
            👥 คนในห้อง ({room.participants.length})
          </h2>
          <ul className="participant-list">
            {room.participants.map((p) => (
              <li key={p.id} className="participant">
                <div className="avatar" style={avatarStyle(p.name)}>
                  {p.name[0]?.toUpperCase() ?? "?"}
                </div>
                <span>{p.name === name ? `${p.name} (คุณ)` : p.name}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
