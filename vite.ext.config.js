import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

// 扩展专用配置：把 content script 与 background service worker 打包成
// 独立 IIFE bundle（MV3 的 content script 不能是 ES module，也禁代码分包）。
// 通过 --mode content / --mode background 区分入口，避免共享模块触发分包错误。
export default defineConfig(({ mode }) => {
	const entry =
		mode === "background"
			? { background: r("src/background/background.js") }
			: { content: r("src/content/content.js") };
	return {
		build: {
			outDir: "dist",
			emptyOutDir: false,
			target: "chrome102",
			rollupOptions: {
				input: entry,
				output: {
					format: "iife",
					entryFileNames: "[name].js",
					assetFileNames: "assets/[name][extname]",
				},
			},
		},
	};
});
