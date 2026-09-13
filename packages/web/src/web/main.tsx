import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as Sentry from "@sentry/react";
import "./styles.css";
import App from "./app.tsx";

const queryClient = new QueryClient();

const dsn = import.meta.env.VITE_SENTRY_DSN_FRONTEND;

if (dsn) {
	Sentry.init({
		dsn,
		environment: import.meta.env.MODE,
		tracesSampleRate: 0.1,
		sendDefaultPii: false,
		beforeSend(event) {
			return stripSensitiveFields(event) as typeof event;
		},
	});
} else {
	console.warn("[sentry] VITE_SENTRY_DSN_FRONTEND nicht gesetzt — Fehlerüberwachung deaktiviert.");
}

// Entfernt rekursiv Felder mit sensiblen Namen (Groß-/Kleinschreibung egal) aus dem Sentry-Event,
// bevor es gesendet wird — Datensparsamkeit (keine Tokens/Keys/Passwörter in Sentry).
const SENSITIVE_KEYS = /^(token|key|secret|password|authorization)$/i;

function stripSensitiveFields<T>(value: T, seen = new WeakSet<object>()): T {
	if (value === null || typeof value !== "object") return value;
	if (seen.has(value as object)) return value;
	seen.add(value as object);

	if (Array.isArray(value)) {
		return value.map((item) => stripSensitiveFields(item, seen)) as unknown as T;
	}

	const result: Record<string, unknown> = {};
	for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
		if (SENSITIVE_KEYS.test(key)) continue;
		result[key] = stripSensitiveFields(val, seen);
	}
	return result as T;
}

function SentryFallback() {
	return (
		<div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0F172A", color: "#fff", fontFamily: "'Poppins', sans-serif", padding: 24, textAlign: "center" }}>
			<div>
				<h2 style={{ marginBottom: 8 }}>Ein unerwarteter Fehler ist aufgetreten</h2>
				<p style={{ color: "#94A3B8", marginBottom: 16 }}>
					Der Fehler wurde automatisch erfasst. Bitte lade die Seite neu.
				</p>
				<button
					onClick={() => window.location.reload()}
					style={{ background: "#8B5CF6", color: "#fff", border: "none", borderRadius: 8, padding: "10px 20px", fontWeight: 600, cursor: "pointer" }}
				>
					Seite neu laden
				</button>
			</div>
		</div>
	);
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<Sentry.ErrorBoundary fallback={<SentryFallback />}>
			<QueryClientProvider client={queryClient}>
				<Router>
					<App />
				</Router>
			</QueryClientProvider>
		</Sentry.ErrorBoundary>
	</StrictMode>,
);
