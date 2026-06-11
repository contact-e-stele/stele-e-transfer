import { useState } from "react";

interface LoginProps {
  onLogin: (username: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json() as { ok: boolean; error?: string; username?: string };
      if (data.ok && data.username) {
        onLogin(data.username);
      } else {
        setError(data.error || "Login fehlgeschlagen");
      }
    } catch {
      setError("Verbindungsfehler");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0F172A",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'Poppins', sans-serif",
    }}>
      <div style={{
        background: "#1E293B",
        borderRadius: 16,
        padding: "40px 36px",
        width: "100%",
        maxWidth: 380,
        boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
      }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>⚡</div>
          <h1 style={{ color: "#F59E0B", fontSize: 22, fontWeight: 700, margin: 0 }}>STELE-E-TRANSFER</h1>
          <p style={{ color: "#64748B", fontSize: 13, margin: "6px 0 0" }}>Dropshipping Manager</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <input
              type="text"
              placeholder="Benutzername"
              value={username}
              onChange={e => setUsername(e.target.value)}
              style={{
                width: "100%",
                background: "#0F172A",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "11px 14px",
                color: "#F1F5F9",
                fontSize: 14,
                outline: "none",
              }}
              required
            />
          </div>
          <div style={{ marginBottom: 20 }}>
            <input
              type="password"
              placeholder="Passwort"
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{
                width: "100%",
                background: "#0F172A",
                border: "1px solid #334155",
                borderRadius: 8,
                padding: "11px 14px",
                color: "#F1F5F9",
                fontSize: 14,
                outline: "none",
              }}
              required
            />
          </div>

          {error && (
            <div style={{ color: "#F87171", fontSize: 13, marginBottom: 14, textAlign: "center" }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              background: loading ? "#475569" : "#F59E0B",
              color: "#000",
              border: "none",
              borderRadius: 8,
              padding: "12px",
              fontSize: 15,
              fontWeight: 700,
              cursor: loading ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "..." : "Einloggen"}
          </button>
        </form>
      </div>
    </div>
  );
}
