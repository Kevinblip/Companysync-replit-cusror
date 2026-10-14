import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from "path"
import fs from "fs"
import { gzipSync, brotliCompressSync, constants as zlibConstants } from "node:zlib"
import { fileURLToPath } from "url"
import twilioWsPlugin from "./vite-twilio-ws-plugin.js"
import lexiNativePlugin from "./vite-lexi-native-plugin.js"
import signingProxyPlugin from "./vite-signing-plugin.js"
import dbPlugin from "./vite-db-plugin.js"
import authPlugin from "./vite-auth-plugin.js"
import functionsPlugin from "./vite-functions-plugin.js"
import integrationsPlugin from "./vite-integrations-plugin.js"
import cronPlugin from "./vite-cron-plugin.js"
import stripePlugin from "./vite-stripe-plugin.js"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function copyProdServer() {
  return {
    name: 'copy-prod-server',
    closeBundle() {
      const src = path.resolve(__dirname, 'prod-server.cjs');
      const dest = path.resolve(__dirname, 'dist', 'index.cjs');
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log('[Build] Copied prod-server.cjs -> dist/index.cjs');
      }
      const dbDir = path.resolve(__dirname, 'db');
      const distDbDir = path.resolve(__dirname, 'dist', 'db');
      if (fs.existsSync(dbDir)) {
        if (!fs.existsSync(distDbDir)) fs.mkdirSync(distDbDir, { recursive: true });
        for (const file of fs.readdirSync(dbDir)) {
          fs.copyFileSync(path.join(dbDir, file), path.join(distDbDir, file));
        }
        console.log('[Build] Copied db/ -> dist/db/');
      }
      // Copy lib/ (CJS helper modules required by prod-server.cjs at runtime)
      const libDir = path.resolve(__dirname, 'lib');
      const distLibDir = path.resolve(__dirname, 'dist', 'lib');
      if (fs.existsSync(libDir)) {
        if (!fs.existsSync(distLibDir)) fs.mkdirSync(distLibDir, { recursive: true });
        for (const file of fs.readdirSync(libDir)) {
          fs.copyFileSync(path.join(libDir, file), path.join(distLibDir, file));
        }
        console.log('[Build] Copied lib/ -> dist/lib/');
      }
      for (const pluginFile of ['vite-functions-plugin.js', 'vite-stripe-plugin.js']) {
        const pluginSrc = path.resolve(__dirname, pluginFile);
        const pluginDest = path.resolve(__dirname, 'dist', pluginFile);
        if (fs.existsSync(pluginSrc)) {
          fs.copyFileSync(pluginSrc, pluginDest);
        }
      }
      console.log('[Build] Copied plugin files -> dist/');

      // Vite already copies public/ into dist/. Do not duplicate it under
      // dist/public/ — that previously added about 1.1 GiB to the VM image.
      //
      // Local user uploads and UUID-named root media are gitignored and served
      // from object storage in production. Remove only those development copies
      // from dist while preserving tracked marketing/training assets.
      const distDir = path.resolve(__dirname, 'dist');
      const distUploadsDir = path.join(distDir, 'uploads');
      if (fs.existsSync(distUploadsDir)) {
        fs.rmSync(distUploadsDir, { recursive: true, force: true });
      }
      const rootUploadPattern = /^[0-9a-f]{8}-[0-9a-f-]{27,}\.(?:jpe?g|png|webp)$/i;
      for (const file of fs.readdirSync(distDir)) {
        if (rootUploadPattern.test(file)) fs.rmSync(path.join(distDir, file), { force: true });
      }
      console.log('[Build] Removed development-only upload copies from dist/');
      // Compress only generated assets, never customer uploads or source media.
      const assetsDir = path.join(distDir, 'assets');
      let compressedCount = 0;
      for (const file of fs.readdirSync(assetsDir)) {
        if (!/\.(js|css|svg)$/.test(file)) continue;
        const assetPath = path.join(assetsDir, file);
        const content = fs.readFileSync(assetPath);
        if (content.length < 1024) continue;
        fs.writeFileSync(assetPath + '.gz', gzipSync(content));
        fs.writeFileSync(assetPath + '.br', brotliCompressSync(content, {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 4 }
        }));
        compressedCount++;
      }
      console.log(`[Build] Precompressed ${compressedCount} generated assets for faster mobile loading.`);

      // Plugins imported by this config (pg pools, cron timers) keep the Node
      // process alive after a successful build, so `vite build` never exits on
      // hosts like Railway and the build times out. Same fix as
      // cursor/local-cursor-dev-0f16. Skip for --watch builds.
      if (!process.argv.includes('--watch')) {
        setTimeout(() => process.exit(0), 500);
      }
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: [
      { find: '@/functions', replacement: path.resolve(__dirname, './functions') },
      { find: '@', replacement: path.resolve(__dirname, './src') },
    ],
    dedupe: ['react', 'react-dom', 'react/jsx-runtime']
  },
  optimizeDeps: {
    include: ['react', 'react-dom', '@hello-pangea/dnd'],
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
    watch: {
      ignored: [
        '**/.cache/**',
        '**/.git/**',
        '**/.local/**',
        '**/.agents/**',
        '**/dist/**',
      ],
    },
  },
  logLevel: 'info', // Show info logs
  plugins: [
    base44({
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: false,
      navigationNotifier: false
    }),
    react(),
    authPlugin(),
    dbPlugin(),
    functionsPlugin(),
    integrationsPlugin(),
    twilioWsPlugin(),
    lexiNativePlugin(),
    signingProxyPlugin(),
    cronPlugin(),
    stripePlugin(),
    copyProdServer(),
  ]
});