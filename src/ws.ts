// WebSocket wrapper with auto-reconnect.
//
// One instance per Room mount; closes on unmount. Re-sends the `join` message
// on reconnect so the server reseats us in the room without any UI knowing.

import type {
  ClientMessage,
  RoomState,
  SearchResult,
  SearchSource,
  ServerMessage,
} from "./types";

export type ConnectionStatus =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed";

export type SearchResultsEvent = {
  query: string;
  source: SearchSource;
  results: SearchResult[];
};

type StateListener = (state: RoomState, arrivedAt: number) => void;
type ErrorListener = (message: string) => void;
type StatusListener = (status: ConnectionStatus) => void;
type SearchResultsListener = (event: SearchResultsEvent) => void;

const RECONNECT_DELAY_MS = 2000;

export class RoomClient {
  private socket: WebSocket | null = null;
  private listeners = new Set<StateListener>();
  private errorListeners = new Set<ErrorListener>();
  private statusListeners = new Set<StatusListener>();
  private searchListeners = new Set<SearchResultsListener>();
  private reconnectTimer: number | null = null;
  private pendingJoin: { roomId: string; name: string } | null = null;
  private isClosed = false;
  private status: ConnectionStatus = "connecting";
  private hasBeenOpen = false;

  connect(roomId: string, name: string) {
    this.pendingJoin = { roomId, name };
    this.isClosed = false;
    this.setStatus("connecting");
    this.openSocket();
  }

  private setStatus(s: ConnectionStatus) {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  private openSocket() {
    if (this.isClosed) return;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.hasBeenOpen = true;
      this.setStatus("open");
      if (this.pendingJoin) {
        this.send({
          type: "join",
          roomId: this.pendingJoin.roomId,
          name: this.pendingJoin.name,
        });
      }
    });

    socket.addEventListener("message", (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === "state") {
        const arrivedAt = Date.now();
        this.listeners.forEach((l) => l(msg.room, arrivedAt));
      } else if (msg.type === "search_results") {
        const event: SearchResultsEvent = {
          query: msg.query,
          source: msg.source,
          results: msg.results,
        };
        this.searchListeners.forEach((l) => l(event));
      } else if (msg.type === "error") {
        this.errorListeners.forEach((l) => l(msg.message));
      }
    });

    socket.addEventListener("close", () => {
      this.socket = null;
      if (this.isClosed) {
        this.setStatus("closed");
        return;
      }
      this.setStatus(this.hasBeenOpen ? "reconnecting" : "connecting");
      this.reconnectTimer = window.setTimeout(
        () => this.openSocket(),
        RECONNECT_DELAY_MS,
      );
    });

    socket.addEventListener("error", () => {
      // 'close' fires right after; reconnect handled there
    });
  }

  send(msg: ClientMessage) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  onState(listener: StateListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onError(listener: ErrorListener) {
    this.errorListeners.add(listener);
    return () => {
      this.errorListeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    // Fire immediately so consumers don't have to mirror initial state.
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  onSearchResults(listener: SearchResultsListener) {
    this.searchListeners.add(listener);
    return () => {
      this.searchListeners.delete(listener);
    };
  }

  close() {
    this.isClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        this.socket.close();
      } catch {}
      this.socket = null;
    }
    this.setStatus("closed");
  }
}

/**
 * Compute the player's "effective" current position right now.
 *
 * Uses `stateArrivedAt` (when *this client* received the state) as the
 * client-side clock anchor — NOT `Date.now() - serverNow`. The latter would
 * assume client and server clocks are synchronised, which fails badly on
 * devices with > a few seconds of clock skew (causes constant phantom drift).
 *
 * Formula (when playing):
 *   effective = position
 *             + (serverNow - positionUpdatedAt) / 1000   // server-side elapsed
 *             + (Date.now() - stateArrivedAt)  / 1000   // local-side elapsed
 *
 * Both terms only subtract values from the SAME clock, so they're invariant
 * to clock skew. Network latency adds ~50-200 ms of bias which the drift
 * threshold absorbs.
 */
export function effectivePosition(
  position: number,
  positionUpdatedAt: number,
  serverNow: number,
  stateArrivedAt: number,
  playing: boolean,
): number {
  if (!playing) return position;
  const serverElapsedSec = Math.max(0, (serverNow - positionUpdatedAt) / 1000);
  const clientElapsedSec = Math.max(0, (Date.now() - stateArrivedAt) / 1000);
  return position + serverElapsedSec + clientElapsedSec;
}
