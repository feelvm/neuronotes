import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	css: {
		devSourcemap: true
	},
	resolve: {
		alias: {
			// Stub Tauri modules for browser builds (they're dynamically imported conditionally)
			'@tauri-apps/plugin-fs': './src/lib/tauri-stubs/plugin-fs.ts',
			'@tauri-apps/api': './src/lib/tauri-stubs/api.ts',
			'@tauri-apps/plugin-sql': './src/lib/tauri-stubs/plugin-sql.ts'
		}
	},
	build: {
		// Enable minification and tree-shaking
		minify: 'terser',
		terserOptions: {
			compress: {
				drop_console: false, // Keep console.log for debugging (can be removed later)
				drop_debugger: true,
				passes: 2 // Multiple passes for better optimization
			}
		},
		// Reduce chunk size warnings threshold
		chunkSizeWarningLimit: 1000
		// Note: SvelteKit handles code splitting automatically,
		// so we don't need manualChunks configuration
	},
	optimizeDeps: {
		exclude: ['@tauri-apps/plugin-fs', '@tauri-apps/api', '@tauri-apps/plugin-sql']
	}
});
