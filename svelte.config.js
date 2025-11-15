import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    adapter: adapter({
      pages: 'build',   // default
      assets: 'build',  // default
      fallback: 'index.html', // ensures SPA fallback
      precompress: false
    })
  }
};

export default config;