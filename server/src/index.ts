// M4KiEs Room — Fastify HTTP + WebSocket server.
//
// Responsibilities:
//   - Serve the built React client (static files) at /
//   - SPA fallback so /r/<code> serves index.html
//   - POST /api/rooms to create a fresh room
//   - WS /ws  for join/play/pause/seek/etc.
//
// Room state is in-memory only — restarting the server clears every room.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

import Fastify from "fastify";
import websocket from "@fastify/websocket";
import staticFiles from "@fastify/static";

import {
  addParticipant,
  createRoom,
  getOrCreateRoom,
  getRoom,
  newTrackId,
  removeParticipant,
  snapshot,
  touchPosition,
} from "./rooms.js";
import type {
  ClientMessage,
  Participant,
  ServerMessage,
  Track,
} from "./types.js";
import { resolveYouTubeAudio, searchYouTube } from "./youtube.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? "0.0.0.0";
// Default static dir = sibling `dist/` two levels above this file (the PWA
// build is at <repo>/dist; this file runs from <repo>/server/dist/index.js).
// Override with STATIC_DIR env var in Docker.
const STATIC_DIR =
  process.env.STATIC_DIR ?? path.resolve(__dirname, "../../dist");

type Connection = {
  socket: WebSocket;
  participantId: string;
  roomId: string | null;
  name: string;
};

// Minimal WebSocket type — we use the bits @fastify/websocket exposes.
interface WebSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  on(event: "message", cb: (data: Buffer) => void): void;
  on(event: "close", cb: () => void): void;
  on(event: "error", cb: (err: Error) => void): void;
}

const connections = new Map<string, Connection>();
const roomConnections = new Map<string, Set<string>>();

function broadcast(roomId: string, message: ServerMessage): void {
  const conns = roomConnections.get(roomId);
  if (!conns) return;
  const payload = JSON.stringify(message);
  for (const id of conns) {
    const c = connections.get(id);
    if (c && c.socket.readyState === 1) {
      try {
        c.socket.send(payload);
      } catch {
        // swallow — bad sockets get cleaned up by close handler
      }
    }
  }
}

function sendState(roomId: string): void {
  const room = getRoom(roomId);
  if (!room) return;
  broadcast(roomId, { type: "state", room: snapshot(room) });
}

function sendTo(connId: string, message: ServerMessage): void {
  const c = connections.get(connId);
  if (c && c.socket.readyState === 1) {
    try {
      c.socket.send(JSON.stringify(message));
    } catch {}
  }
}

async function handleMessage(connId: string, msg: ClientMessage): Promise<void> {
  const conn = connections.get(connId);
  if (!conn) return;

  if (msg.type === "ping") {
    sendTo(connId, { type: "pong" });
    return;
  }

  // Search doesn't need a room — anyone can search to browse the library
  if (msg.type === "search") {
    const query = msg.query.trim();
    if (!query) {
      sendTo(connId, {
        type: "search_results",
        query: "",
        source: msg.source,
        results: [],
      });
      return;
    }
    if (msg.source === "youtube") {
      try {
        const results = await searchYouTube(query);
        sendTo(connId, {
          type: "search_results",
          query,
          source: "youtube",
          results,
        });
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        sendTo(connId, {
          type: "error",
          message: `ค้นบน YouTube ไม่สำเร็จ: ${errMsg}`,
        });
      }
      return;
    }
    if (msg.source === "spotify") {
      sendTo(connId, {
        type: "error",
        message:
          "Spotify search ยังไม่ได้ตั้งค่า — ใส่ SPOTIFY_CLIENT_ID/SECRET ใน server/.env (ดู README)",
      });
      return;
    }
    if (msg.source === "joox") {
      sendTo(connId, {
        type: "error",
        message: "JOOX ไม่มี public API — ใช้ tab YouTube แทนได้เลย",
      });
      return;
    }
    return;
  }

  if (msg.type === "join") {
    const roomId = msg.roomId.toUpperCase();
    const name = (msg.name || "Guest").slice(0, 32);
    const participant: Participant = { id: connId, name };
    getOrCreateRoom(roomId);
    conn.roomId = roomId;
    conn.name = name;
    addParticipant(roomId, participant);
    let conns = roomConnections.get(roomId);
    if (!conns) {
      conns = new Set();
      roomConnections.set(roomId, conns);
    }
    conns.add(connId);
    sendState(roomId);
    return;
  }

  if (!conn.roomId) {
    sendTo(connId, { type: "error", message: "Not in a room — send join first" });
    return;
  }
  const room = getRoom(conn.roomId);
  if (!room) return;

  switch (msg.type) {
    case "add_track": {
      const t = msg.track;
      if (!t.url || !t.kind) return;

      // For YouTube URLs we resolve to a direct audio stream URL on the
      // server. This bypasses the IFrame's "embed disabled by owner"
      // restriction and lets every client play via HTML5 <audio>.
      let finalUrl = t.url;
      let finalKind: Track["kind"] = t.kind;
      let finalTitle = t.title || t.url;
      let finalDuration = t.duration;
      let finalThumbnail = t.thumbnail;

      if (t.kind === "youtube") {
        try {
          const info = await resolveYouTubeAudio(t.url);
          finalUrl = info.streamUrl;
          finalKind = "audio";
          finalTitle = info.title;
          finalDuration = info.duration;
          finalThumbnail = info.thumbnail;
        } catch (e) {
          const errMsg = e instanceof Error ? e.message : String(e);
          sendTo(connId, {
            type: "error",
            message: `ดึงเสียงจาก YouTube ไม่ได้: ${errMsg}`,
          });
          return;
        }
      }

      const track: Track = {
        id: newTrackId(),
        url: finalUrl,
        title: finalTitle,
        kind: finalKind,
        addedBy: conn.name,
        duration: finalDuration,
        thumbnail: finalThumbnail,
      };
      room.tracks.push(track);
      // Auto-start when adding to an empty queue
      if (room.currentIdx === -1) {
        room.currentIdx = 0;
        room.position = 0;
        room.positionUpdatedAt = Date.now();
        room.playing = true;
      }
      sendState(conn.roomId);
      return;
    }

    case "remove_track": {
      const idx = room.tracks.findIndex((t) => t.id === msg.trackId);
      if (idx < 0) return;
      room.tracks.splice(idx, 1);
      if (idx === room.currentIdx) {
        // Current track removed — try to play next (stay at same idx, next shifts up)
        if (room.currentIdx >= room.tracks.length) {
          room.currentIdx = -1;
          room.playing = false;
        }
        room.position = 0;
        room.positionUpdatedAt = Date.now();
      } else if (idx < room.currentIdx) {
        room.currentIdx -= 1;
      }
      sendState(conn.roomId);
      return;
    }

    case "select": {
      if (msg.index < 0 || msg.index >= room.tracks.length) return;
      room.currentIdx = msg.index;
      room.position = 0;
      room.positionUpdatedAt = Date.now();
      room.playing = true;
      sendState(conn.roomId);
      return;
    }

    case "skip": {
      if (room.currentIdx === -1) return;
      if (room.currentIdx + 1 < room.tracks.length) {
        room.currentIdx += 1;
        room.position = 0;
        room.playing = true;
      } else {
        room.currentIdx = -1;
        room.playing = false;
        room.position = 0;
      }
      room.positionUpdatedAt = Date.now();
      sendState(conn.roomId);
      return;
    }

    case "play": {
      if (room.currentIdx === -1 && room.tracks.length > 0) {
        room.currentIdx = 0;
        room.position = 0;
      }
      touchPosition(room);
      room.playing = true;
      sendState(conn.roomId);
      return;
    }

    case "pause": {
      touchPosition(room);
      room.playing = false;
      sendState(conn.roomId);
      return;
    }

    case "seek": {
      room.position = Math.max(0, msg.position);
      room.positionUpdatedAt = Date.now();
      sendState(conn.roomId);
      return;
    }
  }
}

async function start(): Promise<void> {
  const fastify = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
  });

  await fastify.register(websocket);

  // Tolerate POST without a body (or with a content-type Fastify doesn't know).
  // Without this, `fetch("/api/rooms", {method:"POST"})` returns 415.
  // Anchored regex avoids FastifySecurity FSTSEC001 warning.
  fastify.addContentTypeParser(
    /^.*$/,
    { parseAs: "string" },
    (_req, body, done) => done(null, body || null),
  );

  // Static client. `decorateReply: true` (default) is required so the SPA
  // fallback below can call `reply.sendFile("index.html")`.
  await fastify.register(staticFiles, {
    root: STATIC_DIR,
    prefix: "/",
  });

  // SPA fallback — any non-API path serves index.html
  fastify.setNotFoundHandler((req, reply) => {
    const url = req.raw.url ?? "";
    if (url.startsWith("/api") || url.startsWith("/ws")) {
      reply.code(404).send({ error: "not found" });
      return;
    }
    reply.type("text/html").sendFile("index.html");
  });

  // Create a new room
  fastify.post("/api/rooms", async () => {
    const room = createRoom();
    return { id: room.id };
  });

  // Health check (useful for Fly.io / Railway)
  fastify.get("/api/health", async () => ({ ok: true }));

  await fastify.register(async (instance) => {
    instance.get<{ Querystring: { roomId?: string } }>(
      "/ws",
      { websocket: true },
      (socket, _req) => {
        const connId = randomBytes(8).toString("hex");
        const conn: Connection = {
          socket: socket as unknown as WebSocket,
          participantId: connId,
          roomId: null,
          name: "Guest",
        };
        connections.set(connId, conn);

        (socket as unknown as WebSocket).on("message", (data: Buffer) => {
          let msg: ClientMessage;
          try {
            msg = JSON.parse(data.toString()) as ClientMessage;
          } catch {
            sendTo(connId, { type: "error", message: "Invalid JSON" });
            return;
          }
          handleMessage(connId, msg).catch((e) => {
            fastify.log.error({ err: e }, "handleMessage threw");
            sendTo(connId, { type: "error", message: "Server error" });
          });
        });

        (socket as unknown as WebSocket).on("close", () => {
          if (conn.roomId) {
            removeParticipant(conn.roomId, connId);
            const roomConns = roomConnections.get(conn.roomId);
            if (roomConns) {
              roomConns.delete(connId);
              if (roomConns.size === 0) roomConnections.delete(conn.roomId);
            }
            sendState(conn.roomId);
          }
          connections.delete(connId);
        });

        (socket as unknown as WebSocket).on("error", (err: Error) => {
          fastify.log.warn({ err }, "ws error");
        });
      },
    );
  });

  await fastify.listen({ port: PORT, host: HOST });
  fastify.log.info(`🎀 M4KiEs Room server up on ${HOST}:${PORT}`);
  fastify.log.info(`static dir: ${STATIC_DIR}`);
}

start().catch((err) => {
  console.error("Failed to start:", err);
  process.exit(1);
});
