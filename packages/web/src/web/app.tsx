import { Route, Switch, useLocation } from "wouter";
import Index from "./pages/index";
import AutoDS from "./pages/autods";
import Dashboard from "./pages/dashboard";
import { Provider } from "./components/provider";
import { AgentFeedback, RunableBadge } from "@runablehq/website-runtime";

function TabNav() {
  const [location, setLocation] = useLocation();

  const tabBase: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
    padding: "9px 14px", borderRadius: 10, border: "none",
    fontSize: 13, fontWeight: 600, cursor: "pointer",
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

  const tabs = [
    { path: "/", label: "💰 Preise" },
    { path: "/autods", label: "📝 Beschreibung" },
    { path: "/dashboard", label: "📦 Produkte" },
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
          >
            {tab.label}
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
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <TabNav />
      <Switch>
        <Route path="/" component={Index} />
        <Route path="/autods" component={AutoDS} />
        <Route path="/dashboard" component={Dashboard} />
      </Switch>
      {import.meta.env.DEV && <AgentFeedback />}
      {<RunableBadge />}
    </Provider>
  );
}

export default App;
