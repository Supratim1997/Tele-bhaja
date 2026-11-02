import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src/client',
  publicDir: '../../public',
  build: {
    outDir: '../../dist/public',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src/client'),
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    // Allow any host, including Tailscale 100.x.y.z IPs and *.ts.net MagicDNS domains
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
