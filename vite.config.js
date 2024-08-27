import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: 'public/index.html', // Adjust this path to point to your public folder
      }
    }
  }
});
