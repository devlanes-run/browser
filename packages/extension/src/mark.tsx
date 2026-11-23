/** The devlanes mark: three rounded bars staggered right, the top one in paint. */
export function Mark() {
  return (
    <svg class="mark" viewBox="8 16 48 32" aria-hidden="true" focusable="false">
      <rect x="8" y="16" width="32" height="8" rx="4" fill="var(--paint)" />
      <rect x="16" y="28" width="32" height="8" rx="4" />
      <rect x="24" y="40" width="32" height="8" rx="4" />
    </svg>
  );
}
