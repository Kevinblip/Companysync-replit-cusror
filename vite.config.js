import base44 from "@base44/vite-plugin"
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import path from "path"
import fs from "fs"
import { fileURLToPath } from "url"
import { viteStaticCopy } from 'vite-plugin-static-copy'
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
      for (const pluginFile of ['vite-functions-plugin.js', 'vite-stripe-plugin.js']) {
        const pluginSrc = path.resolve(__dirname, pluginFile);
        const pluginDest = path.resolve(__dirname, 'dist', pluginFile);
        if (fs.existsSync(pluginSrc)) {
          fs.copyFileSync(pluginSrc, pluginDest);
        }
      }
      console.log('[Build] Copied plugin files -> dist/');

      // Mirror frontend files into dist/public/ so Replit's publicDir check passes
      const distDir = path.resolve(__dirname, 'dist');
      const publicDir = path.resolve(__dirname, 'dist', 'public');
      if (!fs.existsSync(publicDir)) fs.mkdirSync(publicDir, { recursive: true });
      const htmlSrc = path.join(distDir, 'index.html');
      if (fs.existsSync(htmlSrc)) fs.copyFileSync(htmlSrc, path.join(publicDir, 'index.html'));
      const assetsSrc = path.join(distDir, 'assets');
      const assetsDest = path.join(publicDir, 'assets');
      if (fs.existsSync(assetsSrc)) {
        if (!fs.existsSync(assetsDest)) fs.mkdirSync(assetsDest, { recursive: true });
        for (const file of fs.readdirSync(assetsSrc)) {
          fs.copyFileSync(path.join(assetsSrc, file), path.join(assetsDest, file));
        }
      }
      console.log('[Build] Mirrored frontend to dist/public/');
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
    include: ['react', 'react-dom', '@hello-pangea/dnd']
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true,
    allowedHosts: true,
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
    viteStaticCopy({
      targets: [
        { src: 'public/*', dest: 'public' }
      ]
    }),
  ]
});