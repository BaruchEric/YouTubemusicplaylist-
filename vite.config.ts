import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      rolldownOptions: {
        output: {
          // Libraries that change only on an upgrade get files of their own, so a deploy of
          // app code leaves them in the browser's cache. Each screen is fetched on first
          // open (src/components/LazyViews.tsx), which makes the remaining files.
          codeSplitting: {
            groups: [
              {name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30},
              {name: 'firebase', test: /node_modules[\\/](firebase|@firebase)[\\/]/, priority: 20},
              // Two files for the chart libraries. As one they sat at 492 kB, just under the
              // 500 kB where Vite warns about a file's size.
              {name: 'd3', test: /node_modules[\\/](d3|d3-[^\\/]+|internmap|delaunator|robust-predicates)[\\/]/, priority: 15},
              {name: 'recharts', test: /node_modules[\\/](recharts|victory-vendor|@reduxjs|redux|react-redux|reselect|immer|es-toolkit|decimal\.js-light|eventemitter3)[\\/]/, priority: 10},
              // Without this every icon two screens share becomes a file of 200 bytes.
              {name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 5},
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
