import { restoreLeftover } from './support/host';

/**
 * Runs once before the tests. A run killed before its cleanup leaves the
 * Windows host key pointing at its fake host, and this puts the old value back.
 */
export default function globalSetup(): void {
  restoreLeftover();
}
