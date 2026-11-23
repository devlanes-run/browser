import { readFileSync } from 'node:fs';
import { defineConfig } from '@rsbuild/core';
import { pluginPreact } from '@rsbuild/plugin-preact';
// rsbuild loads this file with Node's own TypeScript support, which needs the `.ts` extension.
import { manifest } from './manifest.ts';
import { pluginManifest } from './manifest-plugin.ts';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig({
  plugins: [pluginPreact({ reactAliasesEnabled: false }), pluginManifest(manifest(version))],
  source: {
    entry: {
      background: { import: '@devlanes/extension/background', html: false },
      popup: '@devlanes/extension/popup'
    }
  },
  html: {
    title: 'devlanes'
  },
  output: {
    // The manifest names files by path, so they keep fixed names at the root.
    filenameHash: false,
    distPath: { js: '', css: '' },
    overrideBrowserslist: ['chrome >= 120']
  },
  // A service worker can't load split chunks, so each entry is one file.
  // This is rsbuild 2's form of `performance.chunkSplit: { strategy: 'all-in-one' }`.
  splitChunks: false
});
