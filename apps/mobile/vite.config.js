import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';

// The shared editor must compile the Mobile UI and native workflows for Android.
// This explicit Vite define applies to both dev and production builds.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {'import.meta.env.VITE_FRAME_TARGET': JSON.stringify('mobile')},
  server: {host: '127.0.0.1', strictPort: true},
  preview: {host: '127.0.0.1', strictPort: true},
  build: {outDir: 'dist', emptyOutDir: true}
});
