import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	plugins: [sveltekit()],
	css: {
		devSourcemap: true
	},
	resolve: {
		alias: {
			// Stub Tauri modules for browser builds (they're dynamically imported conditionally)
			'@tauri-apps/plugin-fs': path.resolve(__dirname, 'src/lib/tauri-stubs/plugin-fs.ts'),
			'@tauri-apps/api': path.resolve(__dirname, 'src/lib/tauri-stubs/api.ts'),
			'@tauri-apps/plugin-sql': path.resolve(__dirname, 'src/lib/tauri-stubs/plugin-sql.ts')
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
		// Enable CSS minification
		cssMinify: true,
		// Reduce chunk size warnings threshold
		chunkSizeWarningLimit: 1000,
		// Optimize chunk splitting for better code splitting
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					// Split Supabase into its own chunk (only loaded when needed)
					if (id.includes('@supabase/supabase-js')) {
						return 'supabase';
					}
					// Split sql.js into its own chunk (only loaded when needed)
					if (id.includes('sql.js')) {
						return 'sqljs';
					}
					// Split DOMPurify into its own chunk (loaded asynchronously)
					if (id.includes('dompurify')) {
						return 'dompurify';
					}
				}
			}
		},
		// Note: SvelteKit handles code splitting automatically,
		// but we add manual chunks for large dependencies to improve initial load
	},
	optimizeDeps: {
		exclude: ['@tauri-apps/plugin-fs', '@tauri-apps/api', '@tauri-apps/plugin-sql']
	},
	ssr: {
		noExternal: ['sql.js']
	},
	assetsInclude: ['**/*.wasm']
});
