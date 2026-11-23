import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RsbuildPlugin } from '@rsbuild/core';

/** Every file `manifest` names, relative to the extension root. */
function filesOf(manifest: chrome.runtime.ManifestV3): Set<string> {
  const files = new Set([
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {})
  ]);
  if (manifest.action?.default_popup) {
    files.add(manifest.action.default_popup);
  }
  if (manifest.background) {
    files.add(manifest.background.service_worker);
  }
  for (const script of manifest.content_scripts ?? []) {
    for (const file of [...(script.js ?? []), ...(script.css ?? [])]) {
      files.add(file);
    }
  }
  for (const entry of manifest.web_accessible_resources ?? []) {
    // A pattern such as `icons/*` may match nothing yet, so only plain paths are checked.
    for (const file of entry.resources.filter((resource) => !resource.includes('*'))) {
      files.add(file);
    }
  }
  return files;
}

/** The part of an rspack compilation the content script check reads. */
interface Entrypoints {
  entrypoints: ReadonlyMap<
    string,
    { getFiles(): string[]; chunks: { getAllAsyncChunks(): unknown[] }[] }
  >;
}

/**
 * The content scripts of `manifest` that the build didn't emit as one
 * self-contained file, each with the reason. Chrome loads content scripts as
 * classic scripts, which can't import or load other chunks.
 */
function splitContentScripts(manifest: chrome.runtime.ManifestV3, build: Entrypoints): string[] {
  const problems: string[] = [];
  for (const file of (manifest.content_scripts ?? []).flatMap((script) => script.js ?? [])) {
    const entry = [...build.entrypoints.values()].find((each) => each.getFiles().includes(file));
    // A file no entry emits is reported as missing.
    if (!entry) {
      continue;
    }
    const others = entry.getFiles().filter((each) => each !== file && !each.endsWith('.map'));
    if (others.length > 0) {
      problems.push(`${file} also needs ${others.join(', ')}`);
    }
    if (entry.chunks.some((chunk) => chunk.getAllAsyncChunks().length > 0)) {
      problems.push(`${file} loads chunks at run time`);
    }
  }
  return problems;
}

/**
 * Writes `manifest` as `manifest.json` next to the build output. The build fails
 * when the manifest names a file the build didn't emit, or a content script that
 * isn't one self-contained file, because Chrome would only report that when
 * someone loads the extension or opens a lane.
 */
export function pluginManifest(manifest: chrome.runtime.ManifestV3): RsbuildPlugin {
  return {
    name: 'devlanes:manifest',
    /** Checks the files `manifest` names, then emits it once rsbuild has emitted everything else. */
    setup(api) {
      // rsbuild copies `public/` outside the compilation, so those files are looked up on disk.
      const publicDir = join(api.context.rootPath, 'public');
      // The report stage runs after rsbuild has emitted the HTML pages.
      api.processAssets({ stage: 'report' }, ({ compilation, sources }) => {
        const missing = [...filesOf(manifest)].filter(
          (file) => !compilation.getAsset(file) && !existsSync(join(publicDir, file))
        );
        if (missing.length > 0) {
          throw new Error(
            `manifest.json names files the build didn't emit: ${missing.join(', ')}. Add them to public/ or fix their paths in manifest.ts.`
          );
        }
        const split = splitContentScripts(manifest, compilation);
        if (split.length > 0) {
          throw new Error(
            `A content script isn't one self-contained file: ${split.join('. ')}. Remove its dynamic and CSS imports.`
          );
        }
        compilation.emitAsset(
          'manifest.json',
          new sources.RawSource(`${JSON.stringify(manifest, null, 2)}\n`)
        );
      });
    }
  };
}
