import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

// 主配置：构建 options 扩展设置页（Vue 应用）
export default defineConfig({
	base: "./",
	plugins: [vue()],
	build: {
		outDir: "dist",
		emptyOutDir: true,
		target: "chrome102",
		rollupOptions: {
			input: {
				options: r("options.html"),
			},
		},
	},
});
