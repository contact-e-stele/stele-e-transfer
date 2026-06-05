import { Route, Switch, useLocation } from "wouter";
import Index from "./pages/index";
import Lieferanten from "./pages/lieferanten";
import Produkte from "./pages/produkte";
import Listings from "./pages/listings";
import Suche from "./pages/suche";
import Retouren from "./pages/retouren";
import { Provider } from "./components/provider";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";

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
            <span style={{ display: "none" }}>{/* sm:block */}</span>
            <span style={{ fontSize: 11 }}>{tab.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function App() {
  return (
    <Provider>
      <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet" />
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        * { box-sizing: border-box; }
      `}</style>
      <TabNav />
      <Switch>
        <Route path="/"            component={Index}       />
        <Route path="/suche"       component={Suche}       />
        <Route path="/lieferanten" component={Lieferanten} />
        <Route path="/produkte"    component={Produkte}    />
        <Route path="/listings"    component={Listings}    />
        <Route path="/retouren"    component={Retouren}    />
      </Switch>
      {import.meta.env.DEV && <AgentFeedback />}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
