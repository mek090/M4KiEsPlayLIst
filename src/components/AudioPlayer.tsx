// HTML5 <audio> wrapper that follows room state.
//
// As of the YouTube embed-block fix the server resolves all kinds (YouTube,
// SoundCloud later, direct audio) into a direct audio URL — so this is the
// ONLY player component the Room needs.
//
// Wires up MediaSession metadata + action handlers so iPhone lock screens
// show "Now Playing" with play/pause/next controls.

import { useEffect, useRef, useState } from "react";
import { effectivePosition } from "../ws";

type Props = {
  url: string;
  title: string;
  thumbnail?: string;
  addedBy?: string;
  playing: boolean;
  position: number;
  serverNow: number;
  positionUpdatedAt: number;
  stateArrivedAt: number;
  enabled: boolean;
  onPlayPause: (playing: boolean) => void;
  onSeek: (position: number) => void;
  onEnded: () => void;
  onSkip: () => void;
  onError?: (message: string) => void;
};

const DRIFT_THRESHOLD_SEC = 1.0;
const VOLUME_STORAGE_KEY = "m4kies.volume";
const MUTED_STORAGE_KEY = "m4kies.muted";

function loadVolume(): number {
  const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (raw === null) return 0.8;
  const v = parseFloat(raw);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.8;
}
function loadMuted(): boolean {
  return localStorage.getItem(MUTED_STORAGE_KEY) === "1";
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${r.toString().padStart(2, "0")}`;
}

export default function AudioPlayer({
  url,
  title,
  thumbnail,
  addedBy,
  playing,
  position,
  serverNow,
  positionUpdatedAt,
  stateArrivedAt,
  enabled,
  onPlayPause,
  onSeek,
  onEnded,
  onSkip,
  onError,
}: Props) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [scrubbing, setScrubbing] = useState<number | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  // Volume + mute are *local* per device (not synced — every person has
  // their own preference). Persist across sessions via localStorage.
  const [volume, setVolume] = useState<number>(() => loadVolume());
  const [muted, setMuted] = useState<boolean>(() => loadMuted());

  // Push volume/muted into the <audio> element whenever they change, and
  // persist immediately so the next track / page reload keeps the level.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
    audio.muted = muted;
    localStorage.setItem(VOLUME_STORAGE_KEY, volume.toFixed(3));
    localStorage.setItem(MUTED_STORAGE_KEY, muted ? "1" : "0");
  }, [volume, muted]);

  useEffect(() => {
    setErrMsg(null);
  }, [url]);

  // === Sync from room state ===
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || scrubbing !== null || !enabled) return;

    const target = effectivePosition(
      position,
      positionUpdatedAt,
      serverNow,
      stateArrivedAt,
      playing,
    );
    if (Math.abs(audio.currentTime - target) > DRIFT_THRESHOLD_SEC) {
      try {
        audio.currentTime = target;
      } catch {}
    }
    if (playing && audio.paused) {
      audio.play().catch((err) => {
        console.warn("audio.play() rejected:", err);
      });
    } else if (!playing && !audio.paused) {
      audio.pause();
    }
  }, [
    playing,
    position,
    positionUpdatedAt,
    serverNow,
    stateArrivedAt,
    url,
    scrubbing,
    enabled,
  ]);

  // === MediaSession (iOS / Android lock screen "Now Playing") ===
  useEffect(() => {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) {
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title,
      artist: addedBy ? `${addedBy} • M4KiEs Room` : "M4KiEs Room",
      artwork: thumbnail
        ? [
            { src: thumbnail, sizes: "512x512", type: "image/jpeg" },
            { src: thumbnail, sizes: "192x192", type: "image/jpeg" },
          ]
        : [],
    });
    navigator.mediaSession.setActionHandler("play", () => onPlayPause(true));
    navigator.mediaSession.setActionHandler("pause", () => onPlayPause(false));
    navigator.mediaSession.setActionHandler("nexttrack", () => onSkip());
    try {
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (typeof details.seekTime === "number") onSeek(details.seekTime);
      });
    } catch {
      // older Safari may not support seekto — ignore
    }
    return () => {
      try {
        navigator.mediaSession.metadata = null;
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
        navigator.mediaSession.setActionHandler("seekto", null);
      } catch {}
    };
  }, [title, addedBy, thumbnail, onPlayPause, onSkip, onSeek]);

  // Keep MediaSession position metadata fresh so lock-screen seek bar
  // matches the room's actual position.
  useEffect(() => {
    if (
      typeof navigator === "undefined" ||
      !("mediaSession" in navigator) ||
      !navigator.mediaSession.setPositionState
    ) {
      return;
    }
    try {
      navigator.mediaSession.setPositionState({
        duration: duration || 0,
        position: Math.min(currentTime, duration || currentTime),
        playbackRate: 1,
      });
    } catch {}
  }, [currentTime, duration]);

  function handleScrubChange(v: number) {
    setScrubbing(v);
    setCurrentTime(v);
  }
  function handleScrubEnd(v: number) {
    setScrubbing(null);
    onSeek(v);
  }

  return (
    <div className="audio-player">
      <div className="audio-art-wrap">
        {thumbnail ? (
          <img
            src={thumbnail}
            alt=""
            className="audio-thumbnail"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="audio-art">🎵</div>
        )}
        {buffering && enabled && (
          <div className="buffering-overlay">
            <div className="spinner" />
            <div className="spinner-label">กำลังโหลด...</div>
          </div>
        )}
        {errMsg && (
          <div className="player-error">
            <div>⚠ {errMsg}</div>
            <button className="btn btn-primary" onClick={onSkip}>
              ⏭ ข้ามเพลงนี้
            </button>
          </div>
        )}
      </div>
      <div className="track-meta">{title}</div>
      {addedBy && <div className="track-by">เพิ่มโดย {addedBy}</div>}
      <audio
        ref={audioRef}
        src={url}
        onTimeUpdate={(e) => {
          if (scrubbing === null) setCurrentTime(e.currentTarget.currentTime);
        }}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onEnded={onEnded}
        onError={() => {
          const msg = "โหลดไฟล์เสียงไม่สำเร็จ — URL อาจหมดอายุหรือถูกบล็อก";
          setErrMsg(msg);
          onError?.(msg);
        }}
        preload="auto"
        playsInline
      />
      <div className="player-controls">
        <button
          className="btn-circle"
          onClick={() => onPlayPause(!playing)}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <button
          className="btn-circle btn-circle-secondary"
          onClick={onSkip}
          aria-label="Skip"
          title="ข้ามเพลง"
        >
          ⏭
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={scrubbing ?? currentTime}
          disabled={!duration}
          onChange={(e) => handleScrubChange(parseFloat(e.target.value))}
          onMouseUp={(e) =>
            handleScrubEnd(parseFloat((e.target as HTMLInputElement).value))
          }
          onTouchEnd={(e) =>
            handleScrubEnd(parseFloat((e.target as HTMLInputElement).value))
          }
          className="seek-bar"
        />
        <span className="time">
          {formatTime(scrubbing ?? currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <div className="volume-row">
        <button
          type="button"
          className="btn btn-ghost btn-icon volume-btn"
          onClick={() => setMuted((m) => !m)}
          aria-label={muted ? "Unmute" : "Mute"}
          title={muted ? "เปิดเสียง" : "ปิดเสียง"}
        >
          {muted || volume === 0 ? "🔇" : volume < 0.5 ? "🔈" : "🔊"}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={muted ? 0 : volume}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            setVolume(v);
            if (v > 0 && muted) setMuted(false);
          }}
          className="volume-slider"
          aria-label="Volume"
        />
        <span className="volume-pct">
          {muted ? "muted" : `${Math.round(volume * 100)}%`}
        </span>
      </div>
    </div>
  );
}
