import { defineConfig } from 'vite';

// './' makes the built page load its JS/CSS with relative paths, so it works
// whether monday hosts it at the root of a URL or under a sub-path.
export default defineConfig({
  base: './',
});
