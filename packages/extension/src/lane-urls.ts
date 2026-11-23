/**
 * The match pattern of every page a lane can serve: HTTPS on any `*.localhost` host
 * and port. The manifest's host permissions and content scripts use it, and so does
 * the background when it looks for lane tabs. This file imports nothing, because
 * Node loads it on its own when rsbuild reads the manifest.
 */
export const LANE_URLS = 'https://*.localhost/*';
