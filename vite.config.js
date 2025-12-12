import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	css: {
		devSourcemap: true
	},
	build: {
		minify: 'terser',
		terserOptions: {
			compress: {
				drop_console: false,
				drop_debugger: true,
				passes: 2
			}
		},
		cssMinify: true,
		chunkSizeWarningLimit: 1000,
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					if (id.includes('@supabase/supabase-js')) {
						return 'supabase';
					}
					if (id.includes('sql.js')) {
						return 'sqljs';
					}
					if (id.includes('dompurify')) {
						return 'dompurify';
					}
				}
			}
		}
	},
	ssr: {
		noExternal: ['sql.js']
	},
	assetsInclude: ['**/*.wasm']
});
