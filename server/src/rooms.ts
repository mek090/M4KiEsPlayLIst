// In-memory room registry. Rooms hold playback state + participant list.
// Empty rooms are GC'd after EMPTY_ROOM_TTL so the server doesn't leak memory.

import { randomBytes } from "node:crypto";

import type { Participant, RoomState } from "./types.js";

// Alphabet without 0/O, 1/I, L — easier to type and read aloud.
const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;
const CLEANUP_INTERVAL_MS = 60_000;
const EMPTY_ROOM_TTL_MS = 5 * 60_000;

type InternalRoom = {
  state: RoomState;
  emptySince: number | null; // epoch ms; null while occupied
};

const rooms = new Map<string, InternalRoom>();

export function makeRoomId(): string {
  for (let attempt = 0; attempt < 10; attempt++) {
    const bytes = randomBytes(CODE_LENGTH);
    let id = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      id += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
    }
    if (!rooms.has(id)) return id;
  }
  throw new Error("could not generate unique room id");
}

export function createRoom(id?: string): RoomState {
  const roomId = id ?? makeRoomId();
  const now = Date.now();
  const state: RoomState = {
    id: roomId,
    tracks: [],
    currentIdx: -1,
    playing: false,
    position: 0,
    positionUpdatedAt: now,
    serverNow: now,
    participants: [],
  };
  rooms.set(roomId, { state, emptySince: now });
  return state;
}

export function getOrCreateRoom(id: string): RoomState {
  const existing = rooms.get(id);
  if (existing) {
    existing.emptySince = null;
    return existing.state;
  }
  return createRoom(id);
}

export function getRoom(id: string): RoomState | undefined {
  return rooms.get(id)?.state;
}

/** Advance `position` based on wall-clock elapsed since last update, then stamp. */
export function touchPosition(room: RoomState): void {
  if (room.playing) {
    const elapsedSec = (Date.now() - room.positionUpdatedAt) / 1000;
    room.position += elapsedSec;
  }
  room.positionUpdatedAt = Date.now();
}

export function addParticipant(
  roomId: string,
  participant: Participant,
): RoomState | null {
  const internal = rooms.get(roomId);
  if (!internal) return null;
  internal.emptySince = null;
  // Avoid duplicates if a flaky reconnect re-joins
  internal.state.participants = internal.state.participants.filter(
    (p) => p.id !== participant.id,
  );
  internal.state.participants.push(participant);
  return internal.state;
}

export function removeParticipant(
  roomId: string,
  participantId: string,
): RoomState | null {
  const internal = rooms.get(roomId);
  if (!internal) return null;
  internal.state.participants = internal.state.participants.filter(
    (p) => p.id !== participantId,
  );
  if (internal.state.participants.length === 0) {
    internal.emptySince = Date.now();
  }
  return internal.state;
}

export function newTrackId(): string {
  return randomBytes(8).toString("hex");
}

/** Snapshot with a fresh `serverNow` so clients can drift-correct. */
export function snapshot(room: RoomState): RoomState {
  return { ...room, serverNow: Date.now() };
}

// Empty-room garbage collector
setInterval(() => {
  const now = Date.now();
  for (const [id, internal] of rooms.entries()) {
    if (
      internal.emptySince !== null &&
      now - internal.emptySince > EMPTY_ROOM_TTL_MS
    ) {
      rooms.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();
