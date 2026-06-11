import { useState, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import Index from "./pages/index";
import Lieferanten from "./pages/lieferanten";
import Produkte from "./pages/produkte";
import Listings from "./pages/listings";
import Suche from "./pages/suche";
import Retouren from "./pages/retouren";
import Einstellungen from "./pages/einstellungen";
import Login from "./pages/login";
import { Provider } from "./components/provider";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";
import { LogOut } from "lucide-react";

function TabNav() {
  const [location, setLocation] = useLocation();

  const tabBase: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
    padding: "9px 10px", borderRadius: 10, border: "none",
    fontSize: 12, fontWeight: 600, cursor: "pointer",
    fontFamily: "'Poppins', sans-serif", transition: "all 0.2s",
    flex: 1,
  };

  const activeTab: React.CSSProperties = {
    ...tabBase,
    background: "#fff",
    color: "#0F172A",
    boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
  };

  const inactiveTab: React.CSSProperties = {
    ...tabBase,
    background: "transparent",
    color: "#64748B",
  };

  // Reihenfolge: Preise → Suche → Import → Produkte → Listings → Retouren
  const tabs = [
    { path: "/",            label: "💰",  title: "Preise"    },
    { path: "/suche",       label: "🔍",  title: "Suche"     },
    { path: "/lieferanten", label: "📦",  title: "Import"    },
    { path: "/produkte",    label: "🗂️",  title: "Produkte" },
    { path: "/listings",    label: "🛒",  title: "Listings"  },
    { path: "/retouren",    label: "🔄",  title: "Retouren"  },
    { path: "/einstellungen", label: "⚙️", title: "Einst."  },
  ];

  return (
    <div style={{
      position: "sticky", top: 0, zIndex: 100,
      background: "#F1F5F9",
      padding: "8px",
      borderBottom: "1px solid #E2E8F0",
    }}>
      <div style={{
        maxWidth: 680, margin: "0 auto",
        display: "flex", gap: 4,
        background: "#E2E8F0",
        borderRadius: 14, padding: 4,
      }}>
        {tabs.map(tab => (
          <button
            key={tab.path}
            style={location === tab.path ? activeTab : inactiveTab}
            onClick={() => setLocation(tab.path)}
            title={tab.title}
          >
            <span>{tab.label}</span>
            <span style={{ fontSize: 11 }}>{tab.title}</span>
          </button>
        ))}
      </div>
      <div style={{ textAlign: "center", marginTop: 3 }}>
        <span style={{
          fontSize: 9, fontWeight: 700, color: "#94A3B8", letterSpacing: 1,
          fontFamily: "monospace",
        }}>v0.5</span>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Session stored in localStorage — no server-side session needed
    const saved = localStorage.getItem("stele_user");
    if (saved) setUser(saved);
    setChecking(false);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("stele_user");
    setUser(null);
  };

  if (checking) {
    return (
      <div style={{ minHeight: "100vh", background: "#0F172A", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 40, height: 40, border: "4px solid #8B5CF6", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  if (!user) {
    return (
      <Provider>
        <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        <Login onLogin={(u) => { localStorage.setItem("stele_user", u); setUser(u); }} />
      </Provider>
    );
  }

  return (
    <Provider>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>
      {/* User Badge + Logout */}
      <div style={{
        position: "fixed", top: 12, right: 12, zIndex: 999,
        display: "flex", alignItems: "center", gap: 8,
        background: "#fff", borderRadius: 10, padding: "6px 12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.12)", fontSize: 12, fontWeight: 700,
        color: "#475569", fontFamily: "'Poppins', sans-serif",
      }}>
        <span style={{ color: "#8B5CF6" }}>{user}</span>
        <button onClick={handleLogout} title="Ausloggen" style={{
          background: "none", border: "none", cursor: "pointer", padding: 2,
          display: "flex", alignItems: "center",
        }}>
          <LogOut size={14} color="#94A3B8" />
        </button>
      </div>
      <TabNav />
      <Switch>
        <Route path="/"            component={Index}       />
        <Route path="/suche"       component={Suche}       />
        <Route path="/lieferanten" component={Lieferanten} />
        <Route path="/produkte"    component={Produkte}    />
        <Route path="/listings"    component={Listings}    />
        <Route path="/retouren"    component={Retouren}    />
        <Route path="/einstellungen" component={Einstellungen} />
      </Switch>
      {import.meta.env.DEV && <AgentFeedback />}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
