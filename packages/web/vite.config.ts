import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite"
import path from "path";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import runableAnalyticsPlugin from "./vite/plugins/runable-analytics-plugin";
import honoDevPlugin from "./vite/plugins/hono-dev-plugin";

const root = path.resolve(__dirname, "../..");

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, root, '');
	Object.assign(process.env, env);

	return {
		// Source Maps werden immer gebaut, damit Sentry lesbare Stacktraces bekommt. Ohne
		// SENTRY_AUTH_TOKEN loggt das Plugin nur eine Warnung und lässt Release-Erstellung/Upload
		// aus (Build bricht nicht ab) — verifiziert per lokalem Testbuild ohne Token.
		build: { sourcemap: true },
		plugins: [
			honoDevPlugin(), react(), runableAnalyticsPlugin(), tailwind(),
			// Muss laut Sentry-Doku als letztes Plugin stehen, damit es die von den anderen
			// Plugins erzeugten Build-Artefakte sieht. Token NUR aus SENTRY_AUTH_TOKEN (Render-Env),
			// nie im Repo. filesToDeleteAfterUpload entfernt die .map-Dateien aus dist/ NACH JEDEM
			// Build — unabhängig davon, ob der Upload stattgefunden hat (deleteArtifacts() läuft im
			// finally-Block der Plugin-internen writeBundle-Hook, siehe node_modules/@sentry/
			// bundler-plugins .../core/build-plugin-manager.js). Sie landen also nie öffentlich im
			// ausgelieferten dist/-Output, auch nicht falls SENTRY_AUTH_TOKEN mal fehlen sollte.
			sentryVitePlugin({
				org: "stele-e-transfer",
				project: "stele-frontend",
				authToken: process.env.SENTRY_AUTH_TOKEN,
				sourcemaps: {
					filesToDeleteAfterUpload: ["./dist/**/*.js.map"],
				},
			}),
		],
		resolve: {
			alias: {
				"@": path.resolve(__dirname, "./src/web"),
			},
		},
		server: {
			allowedHosts: true,
			hmr: { overlay: false, }
		}
	};
});
