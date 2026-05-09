import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      // Needed for bip39, @ton/crypto, bs58, Buffer usage in browser
      include: ['buffer', 'crypto', 'stream', 'util', 'process'],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
  ],
  build: {
    target: 'esnext',
    // Increase chunk size warning limit — crypto libs are large
    chunkSizeWarningLimit: 2000,
  },
  optimizeDeps: {
    include: ['bip39', 'ethers', 'bs58'],
  },
});
