import { fileURLToPath } from 'node:url';
import { writeStoreCopy } from './store';

// `pnpm zip-store` zips this folder. It sits in the ignored artifacts folder, next to the zips.
writeStoreCopy(
  fileURLToPath(new URL('./dist', import.meta.url)),
  fileURLToPath(new URL('./artifacts/store', import.meta.url))
);
