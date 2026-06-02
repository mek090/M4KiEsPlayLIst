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

> **Windows**: หลัง `winget install yt-dlp.yt-dlp` ครั้งแรก ต้อง **เปิด terminal ใหม่** ก่อน เพื่อให้ PATH อัปเดต (ไม่งั้น server จะ log `[yt-dlp] ⚠ NOT FOUND`)

ถ้าวันนึง YouTube พัง: `yt-dlp -U` (เครื่องคุณ) หรือ rebuild Docker image (cloud)

## รัน local

### วิธีเร็วสุด — คำสั่งเดียว รัน server + client พร้อมกัน

```powershell
npm run install:all    # ครั้งแรกเท่านั้น — ลง dependency ทั้ง root + server
npm run dev:all        # รัน client (:5173) + server (:3000) พร้อมกันด้วย concurrently
```

เปิด http://localhost:5173 — Vite จะ proxy `/ws` กับ `/api` ไป server :3000 ให้อัตโนมัติ

ดู log ควรเห็น:
- `[server] 🎀 M4KiEs Room server up on 0.0.0.0:3000`
- `[server] [yt-dlp] ready (v...)`  ← yt-dlp พร้อมใช้แล้ว
- `[client] ➜ Local: http://localhost:5173/`

### หรือแยก 2 terminal (ถ้าอยากเห็น log แยกกัน)

```powershell
# Terminal 1 — server (:3000)
npm --prefix server run dev

# Terminal 2 — client (:5173)
npm run dev
```

### ทดสอบ multi-user

- เปิดหลายๆ tab (หรือ incognito) → เข้าห้องเดียวกัน → กด play ใน tab หนึ่ง ทุก tab ควรเล่นพร้อมกัน
- บนมือถือใน WiFi เดียวกัน: ใช้ **Network URL** ที่ Vite print ออกมา เช่น `http://192.168.1.x:5173` (`host: true` เปิดไว้ใน vite.config.ts แล้ว — ใช้ได้เลยไม่ต้องแก้)

---

## Build production

```powershell
npm run build:all   # build client (→ dist/) + server (→ server/dist/) ในคำสั่งเดียว
npm start           # server serve dist/ ที่ build ไว้ + WebSocket บน :3000
```

เปิด http://localhost:3000 — ตอนนี้ server เสิร์ฟทั้ง client (static) และ WebSocket จาก port เดียว

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

### Render.com (มี `render.yaml` แล้ว)

1. Push repo ขึ้น GitHub
2. https://dashboard.render.com → **New +** → **Blueprint** → เลือก repo
3. Render อ่าน `render.yaml` → กด **Apply** → จะสร้าง web service `m4kies-room` ที่ Singapore
4. Build แรก ~10-15 นาที (Docker + yt-dlp download + npm install)
5. ได้ URL `https://m4kies-room.onrender.com`

> Free tier: 512 MB RAM, sleep หลัง idle 15 นาที (cold start 30-60s), 750 ชม./เดือน

### Fly.io

```powershell
fly launch --no-deploy --copy-config --name m4kies-playlist
# แก้ fly.toml ให้ชี้ Dockerfile = "server/Dockerfile" และ build.context = "."
fly deploy
```

> ⚠ Dockerfile build context ต้องเป็น **repo root** (ไม่ใช่ `server/`) เพราะ stage แรกต้อง copy ทั้ง client (root) + server

จะได้ URL `https://m4kies-playlist.fly.dev`

---

## YouTube anti-bot block บน cloud deploy

**อาการ**: เปิด deploy แล้วใส่ลิงก์ YouTube → `ดึงเสียงจาก YouTube ไม่ได้: ERROR: [youtube] xxx: Sign in to confirm you're not a bot`

**สาเหตุ**: YouTube flag datacenter IPs (Render/Fly/AWS/GCP) เป็น bot traffic แทบทันที — เซิร์ฟเวอร์ local จากที่บ้าน (residential IP) ไม่โดน

**วิธีแก้ — ใส่ cookies ของ browser ที่ login YouTube อยู่**:

1. **Export cookies** จาก browser:
   - Chrome: install [Get cookies.txt LOCALLY](https://chrome.google.com/webstore/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc) extension
   - Firefox: install [cookies.txt](https://addons.mozilla.org/en-US/firefox/addon/cookies-txt/) extension
   - เปิด https://www.youtube.com ใน browser ที่ login Google account อยู่
   - คลิก extension icon → **Export** → save เป็น `cookies.txt` (Netscape format)

2. **Upload ขึ้น Render**:
   - ไป Render dashboard → service `m4kies-room` → tab **Environment**
   - เลื่อนหา **Secret Files** → **Add Secret File**
   - Filename: `yt-cookies.txt` (ต้องชื่อนี้)
   - Content: paste ทุกบรรทัดใน cookies.txt ที่ export มา
   - Save → Render auto-redeploys

3. **Verify**: หลัง redeploy เสร็จ ดู service logs ควรเห็น
   ```
   [yt-dlp] using cookies from /etc/secrets/yt-cookies.txt
   ```
   แล้วลองเล่นเพลง YouTube → ผ่านแล้ว

**Cookies จะหมดอายุประมาณ 1-3 เดือน** — ถ้าเริ่มเจอ error อีกครั้ง export cookies ใหม่ + update Secret File

> ทาง alternative: ใช้ Fly.io / Render ในภูมิภาคที่ YouTube cooler (สลับ region) หรือ residential proxy (เสียเงิน)

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

ทั้งสองเทอม subtract ค่าจากนาฬิกาเดียวกัน → ทนต่อ clock skew ระหว่าง client/server (เครื่องเวลาไม่ตรงก็ยังถูก) Threshold 1.0s — ถ้า drift เกินนี้ค่อย `seekTo()` กลับ

---

## License

ฟรีใช้งาน 🍮
