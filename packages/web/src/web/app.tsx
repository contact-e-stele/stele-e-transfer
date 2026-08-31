import { useState, useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import Index from "./pages/index";
import Lieferanten from "./pages/lieferanten";
import Produkte from "./pages/produkte";
import Listings from "./pages/listings";
import Bestellungen from "./pages/bestellungen";
import Suche from "./pages/suche";
import Retouren from "./pages/retouren";
import Einstellungen from "./pages/einstellungen";
import Login from "./pages/login";
import { Provider } from "./components/provider";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";
import { LogOut, Menu, X } from "lucide-react";

// Reihenfolge: Preise → Suche → Import → Produkte → Listings → Retouren
const NAV_TABS = [
  { path: "/",            label: "💰",  title: "Preise"    },
  { path: "/suche",       label: "🔍",  title: "Suche"     },
  { path: "/lieferanten", label: "📦",  title: "Import"    },
  { path: "/produkte",    label: "🗂️",  title: "Produkte" },
  { path: "/listings",    label: "🛒",  title: "Listings"  },
  { path: "/bestellungen", label: "📬", title: "Bestell."  },
  { path: "/retouren",    label: "🔄",  title: "Retouren"  },
  { path: "/einstellungen", label: "⚙️", title: "Einst."  },
];

function TabNav() {
  const [location, setLocation] = useLocation();
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);

  // Drawer bei Routenwechsel schließen
  useEffect(() => {
    setIsDrawerOpen(false);
  }, [location]);

  // Drawer per Escape schließen
  useEffect(() => {
    if (!isDrawerOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setIsDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDrawerOpen]);

  const activeTitle = NAV_TABS.find(t => t.path === location)?.title ?? "Menü";

  return (
    <div className="stele-tabnav">
      <div className="stele-tabnav-inner">
        <div className="stele-tabnav-row">
          {NAV_TABS.map(tab => (
            <button
              key={tab.path}
              className={`stele-tab${location === tab.path ? " active" : ""}`}
              onClick={() => setLocation(tab.path)}
              title={tab.title}
            >
              <span>{tab.label}</span>
              <span className="stele-tab-label">{tab.title}</span>
            </button>
          ))}
        </div>
        <button
          className="stele-hamburger-btn"
          onClick={() => setIsDrawerOpen(true)}
          aria-expanded={isDrawerOpen}
          aria-label="Menü öffnen"
        >
          <Menu size={16} />
          <span>{activeTitle}</span>
        </button>
      </div>
      <div className="stele-tab-version">v1.6</div>

      <div
        className={`stele-drawer-overlay${isDrawerOpen ? " open" : ""}`}
        onClick={() => setIsDrawerOpen(false)}
        aria-hidden="true"
      />
      <nav
        className={`stele-drawer${isDrawerOpen ? " open" : ""}`}
        aria-hidden={!isDrawerOpen}
      >
        <div className="stele-drawer-header">
          <span>Menü</span>
          <button
            className="stele-drawer-close"
            onClick={() => setIsDrawerOpen(false)}
            aria-label="Menü schließen"
          >
            <X size={18} />
          </button>
        </div>
        {NAV_TABS.map(tab => (
          <button
            key={tab.path}
            className={`stele-drawer-item${location === tab.path ? " active" : ""}`}
            onClick={() => setLocation(tab.path)}
          >
            <span className="stele-drawer-item-icon">{tab.label}</span>
            <span>{tab.title}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function App() {
  const [user, setUser] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Echter Session-Check gegen den Server (httpOnly-Cookie) — localStorage hat keine sicherheitsrelevante Bedeutung mehr
    fetch("/api/auth/me")
      .then(res => res.json())
      .then((data: { loggedIn: boolean; username?: string }) => {
        if (data.loggedIn && data.username) setUser(data.username);
      })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = () => {
    fetch("/api/auth/logout", { method: "POST" }).finally(() => setUser(null));
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
        <Login onLogin={(u) => setUser(u)} />
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
        <Route path="/bestellungen" component={Bestellungen} />
        <Route path="/retouren"    component={Retouren}    />
        <Route path="/einstellungen" component={Einstellungen} />
      </Switch>
      {import.meta.env.DEV && <AgentFeedback />}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
