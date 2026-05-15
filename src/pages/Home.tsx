import { useState } from "react";

type Props = {
  onJoin: (roomId: string) => void;
};

export default function Home({ onJoin }: Props) {
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createRoom() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", { method: "POST" });
      if (!res.ok) throw new Error("create failed");
      const data = (await res.json()) as { id: string };
      onJoin(data.id);
    } catch {
      setError("สร้างห้องไม่สำเร็จ ลองอีกครั้งนะ");
    } finally {
      setCreating(false);
    }
  }

  function joinByCode() {
    const trimmed = code.trim().toUpperCase();
    if (trimmed.length < 4) {
      setError("รหัสห้องสั้นเกินไป");
      return;
    }
    onJoin(trimmed);
  }

  return (
    <div className="home">
      <div className="home-card">
        <h1 className="home-title">🎀 M4KiEs Room</h1>
        <p className="home-subtitle">ฟังเพลงพร้อมเพื่อน ทุก device</p>

        <button
          className="btn btn-primary btn-large"
          onClick={createRoom}
          disabled={creating}
        >
          {creating ? "กำลังสร้าง..." : "🍰 สร้างห้องใหม่"}
        </button>

        <div className="divider">
          <span>หรือ</span>
        </div>

        <div className="join-form">
          <input
            className="input"
            placeholder="ใส่รหัสห้อง (เช่น ABC123)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && joinByCode()}
            maxLength={8}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button className="btn btn-secondary" onClick={joinByCode}>
            🍓 เข้าห้อง
          </button>
        </div>

        {error && (
          <div className="error-banner" onClick={() => setError(null)}>
            ⚠ {error}
          </div>
        )}

        <div className="home-footer">
          <p>
            💡 <strong>iPhone / Android</strong>: เปิดในเบราว์เซอร์ → กด Share →
            "Add to Home Screen" เพื่อใช้เหมือนแอปจริง
          </p>
        </div>
      </div>
    </div>
  );
}
