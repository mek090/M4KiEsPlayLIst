# M4KiEsPlayLIst 🎀

ห้องฟังเพลงพร้อมเพื่อนข้ามอุปกรณ์ — เปิด URL ก็เข้าได้ ไม่ต้องลงแอป ไม่ต้อง login ไม่ต้องบัญชีอะไรเลย

ใช้งานได้บน iPhone, Android, Windows, Mac, Linux — ทุกที่ที่มี browser

## ฟีเจอร์ V1

- ✅ สร้างห้องไม่จำกัด รหัส 6 ตัวอักษร (เช่น `ABCXYZ`)
- ✅ Share ลิงก์ห้องผ่าน Share sheet / clipboard
- ✅ Sync เพลงระหว่างทุกคนในห้อง (URL / play / pause / seek / skip)
- ✅ Democracy mode — ทุกคนกดได้
- ✅ Source: **YouTube** (resolve เป็น direct audio ผ่าน `yt-dlp` ฝั่ง server — bypass embed-block) + **direct audio URL** (.mp3 / .ogg / .wav / .flac / .m4a / .aac / .opus / .webm)
- ✅ PWA — เพิ่มที่ home screen บนมือถือก็ใช้เหมือนแอปจริง
- ✅ Auto-reconnect ถ้า WebSocket หลุด
- ✅ ห้องว่างเกิน 5 นาทีจะถูกล้างอัตโนมัติ
- ✅ Tap-to-start overlay จัดการ iOS autoplay block
- ✅ **MediaSession API** — iPhone lock screen โชว์ "Now Playing" + ปุ่ม play/pause/skip
- ✅ Thumbnail จาก YouTube (16:9 maxres)

## ที่ยังทำไม่ได้

- ❌ **Spotify / JOOX** — ไม่มี public API ให้สตรีมแบบ shared (workaround: หาเพลงเดียวกันบน YouTube)
- 🔜 **Upload ไฟล์เอง** — V2 (ต้องการ object storage เช่น Cloudflare R2)
- 🔜 **Chat ในห้อง** — V2

---

## โครงสร้าง

```
M4KiEsPlayLIst/              ← PWA web app (root)
├── package.json
├── vite.config.ts           — Vite + vite-plugin-pwa
├── tsconfig.*.json
├── index.html               — iOS PWA meta tags ครบ
├── public/
│   └── icons/               — SVG icons (kawaii pink/purple)
├── src/
│   ├── main.tsx
│   ├── App.tsx              — tiny URL router (/r/<CODE>)
│   ├── pages/
│   │   ├── Home.tsx
│   │   └── Room.tsx
│   ├── components/
│   │   └── AudioPlayer.tsx   — HTML5 <audio> + MediaSession (one player for all sources)
│   ├── ws.ts                — WebSocket + drift correction
│   ├── types.ts             — protocol (sync with server)
│   └── styles.css           — kawaii dark theme + mobile-responsive
└── server/                  ← Node + Fastify + WebSocket
    ├── package.json
    ├── Dockerfile           — multi-stage build สำหรับ Fly.io
    └── src/
        ├── index.ts         — Fastify + ws + SPA fallback
        ├── rooms.ts         — in-memory room registry
        ├── youtube.ts       — yt-dlp wrapper (resolve YT → direct audio URL)
        └── types.ts         — protocol types
```

---

## Prerequisites

- Node 18+
- **`yt-dlp` ใน PATH** (สำหรับ resolve YouTube URL) — ติดตั้งครั้งเดียว:
  - Windows: `winget install yt-dlp.yt-dlp`
  - Mac: `brew install yt-dlp`
  - Linux: `pip install yt-dlp` หรือ curl binary จาก https://github.com/yt-dlp/yt-dlp/releases
  - Docker (`server/Dockerfile`) ติดตั้งให้อัตโนมัติแล้ว

ถ้าวันนึง YouTube พัง: `yt-dlp -U` (เครื่องคุณ) หรือ rebuild Docker image (cloud)

## รัน local

ต้องเปิด 2 terminal — server กับ client

### Terminal 1 — server (port 3000)

```powershell
cd server
npm install     # ครั้งแรกเท่านั้น
npm run dev
```

ควรเห็น `🎀 M4KiEs Room server up on 0.0.0.0:3000`

### Terminal 2 — client (port 5173)

```powershell
npm install     # ครั้งแรกเท่านั้น (รันที่ root)
npm run dev
```

ควรเห็น `Local: http://localhost:5173/`

เปิด http://localhost:5173 ในเบราว์เซอร์ — Vite จะ proxy `/ws` กับ `/api` ไปที่ server :3000 ให้

### ทดสอบ multi-user

- เปิดหลายๆ tab (หรือ incognito) → ทุก tab สร้าง / เข้าห้องเดียวกัน → กด play ใน tab หนึ่ง ทุก tab ควรเล่นพร้อมกัน
- หรือเปิดบนมือถือใน WiFi เดียวกัน: ใช้ IP ของเครื่อง dev เช่น `http://192.168.1.x:5173` (อาจต้องแก้ Vite host ใน vite.config.ts ให้เปิด `host: true`)

---

## Build production

```powershell
# client (รันที่ root)
npm run build           # output: dist/

# server
cd server
npm run build           # output: server/dist/
npm start               # serves ../dist + WebSocket on :3000
```

---

## Deploy

### Railway (แนะนำ — ง่ายสุด)

1. Push repo ขึ้น GitHub
2. https://railway.app → Login with GitHub → **New Project** → **Deploy from GitHub repo**
3. ตั้ง config:
   - **Root Directory**: ปล่อยว่าง (= repo root)
   - Railway จะตรวจเจอ `server/Dockerfile` ให้
4. ไม่มี env var ต้องตั้ง (PORT จะถูก set อัตโนมัติ)
5. Deploy → ได้ URL เช่น `m4kies-playlist-production.up.railway.app`

### Fly.io

```powershell
fly launch --no-deploy --copy-config --name m4kies-playlist
# แก้ fly.toml ให้ชี้ Dockerfile = "server/Dockerfile" และ build.context = "."
fly deploy
```

> ⚠ Dockerfile build context ต้องเป็น **repo root** (ไม่ใช่ `server/`) เพราะ stage แรกต้อง copy ทั้ง client (root) + server

จะได้ URL `https://m4kies-playlist.fly.dev`

---

## เปิดบน iPhone

1. เปิด URL ที่ deploy ไว้ใน **Safari** (ต้อง Safari ไม่ใช่ Chrome ถึงจะ add to home screen ได้)
2. กดปุ่ม **Share** (สี่เหลี่ยมมีลูกศรขึ้น)
3. เลื่อนหา **"Add to Home Screen"**
4. ตั้งชื่อ → เพิ่ม
5. มีไอคอน "M4KiEs" บน home screen แล้ว — กดเปิดจะเป็น fullscreen ไม่มีแถบ Safari
6. ครั้งแรกที่เข้าห้องจะเห็น overlay **🍡 แตะเพื่อเริ่มฟัง** — แตะครั้งเดียวพอ (iOS autoplay block)

## เปิดบน Android

1. เปิด URL ใน **Chrome**
2. Chrome จะถามว่าจะ "Install" ไหม กดเลย — หรือกดเมนู 3 จุด → "Install app"
3. ได้ไอคอนแอปเหมือนแอปจริง

---

## Protocol (WebSocket /ws)

ข้อความทั้งหมดเป็น JSON UTF-8 1 message = 1 JSON object

**Client → Server**

```ts
{ type: "join",  roomId: "ABCXYZ", name: "ชื่อ" }
{ type: "add_track", track: { url, title, kind: "youtube" | "audio" } }
{ type: "remove_track", trackId }
{ type: "select", index }
{ type: "skip" }
{ type: "play" }
{ type: "pause" }
{ type: "seek", position }   // seconds
{ type: "ping" }
```

**Server → Client**

```ts
{ type: "state", room: RoomState }   // sent on every change
{ type: "error", message }
{ type: "pong" }
```

ดูชนิดเต็มที่ [server/src/types.ts](server/src/types.ts) (และ [src/types.ts](src/types.ts) ฝั่ง client)

### Drift correction

Server snapshot รวม `serverNow` + `positionUpdatedAt`. Client เก็บ `stateArrivedAt` ของ snapshot นั้น (ตอน WS message มาถึง) แล้วคำนวณ:

```
effective_position = position
                   + (serverNow - positionUpdatedAt) / 1000   // server-side elapsed
                   + (Date.now() - stateArrivedAt)  / 1000    // client-side elapsed
```

ทั้งสองเทอม subtract ค่าจากนาฬิกาเดียวกัน → ทนต่อ clock skew ระหว่าง client/server (เครื่องเวลาไม่ตรงก็ยังถูก) Threshold 1.5s — ถ้า drift เกินนี้ค่อย `seekTo()` กลับ

---

## License

ฟรีใช้งาน 🍮
