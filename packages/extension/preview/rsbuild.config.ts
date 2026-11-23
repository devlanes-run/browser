import { defineConfig } from '@rsbuild/core';
import { pluginPreact } from '@rsbuild/plugin-preact';

// The popup with a fake background, for development and screenshots. It never ships in the extension.
export default defineConfig({
  plugins: [pluginPreact({ reactAliasesEnabled: false })],
  source: {
    entry: { index: './preview/index.tsx' }
  },
  html: {
    title: 'devlanes popup preview'
  },
  output: {
    distPath: { root: 'preview/dist' },
    // Relative paths let the screenshots load the build from file:// without a server.
    assetPrefix: './',
    overrideBrowserslist: ['chrome >= 120']
  }
});
