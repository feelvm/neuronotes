import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	css: {
		devSourcemap: true
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
	ssr: {
		noExternal: ['sql.js']
	},
	assetsInclude: ['**/*.wasm']
});
