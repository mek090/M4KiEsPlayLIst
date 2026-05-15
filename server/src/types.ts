// Shared protocol types. Keep in sync with client/src/types.ts.

export type TrackKind = "youtube" | "audio";

export type Track = {
  id: string;
  url: string;
  title: string;
  kind: TrackKind;
  addedBy: string;
  duration?: number;
  thumbnail?: string;
};

export type Participant = {
  id: string;
  name: string;
};

export type RoomState = {
  id: string;
  tracks: Track[];
  currentIdx: number;        // -1 when nothing playing
  playing: boolean;
  position: number;          // seconds — last known position
  positionUpdatedAt: number; // server epoch ms when position was last set
  serverNow: number;         // server epoch ms at snapshot time (for drift)
  participants: Participant[];
};

export type SearchSource = "youtube" | "spotify" | "joox";

export type SearchResult = {
  id: string;
  source: SearchSource;
  url: string;
  title: string;
  artist?: string;
  duration: number;
  thumbnail?: string;
};

export type ClientMessage =
  | { type: "join"; roomId: string; name: string }
  | { type: "add_track"; track: Omit<Track, "id" | "addedBy"> }
  | { type: "remove_track"; trackId: string }
  | { type: "select"; index: number }
  | { type: "skip" }
  | { type: "play" }
  | { type: "pause" }
  | { type: "seek"; position: number }
  | { type: "search"; query: string; source: SearchSource }
  | { type: "ping" };

export type ServerMessage =
  | { type: "state"; room: RoomState }
  | {
      type: "search_results";
      query: string;
      source: SearchSource;
      results: SearchResult[];
    }
  | { type: "error"; message: string }
  | { type: "pong" };
