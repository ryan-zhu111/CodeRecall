/** The open C recalls a loop; its inner chevron is a code prompt. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="32"
      height="32"
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <rect width="64" height="64" rx="17" fill="#1d1d1f" />
      <rect
        x="0.5"
        y="0.5"
        width="63"
        height="63"
        rx="16.5"
        stroke="white"
        strokeOpacity="0.14"
      />
      <path
        d="M43.5 18.2A18 18 0 1 0 43.5 45.8"
        stroke="white"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <path
        d="M38 24L46 32L38 40"
        stroke="white"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
