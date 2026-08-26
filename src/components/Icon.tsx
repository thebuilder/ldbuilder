/**
 * Inline SVG icons.
 *
 * These were Unicode glyphs (U+25C0, U+25B6). Those pick up whatever the user's
 * font stack has for them, which varies from a solid triangle to a hollow arrow
 * to an emoji, and they carry font metrics that refuse to align with adjacent
 * text. Drawn paths look the same everywhere and sit exactly where they are put.
 */

interface IconProps {
  className?: string;
}

interface GlyphProps extends IconProps {
  children: React.ReactNode;
  /** Filled glyphs (play, pause) draw with fill rather than stroke. */
  filled?: boolean;
}

/**
 * Every icon here is decorative: each one sits next to a text label or inside a
 * button that carries its own aria-label. aria-hidden is written literally
 * rather than spread in, so a11y tooling can see it.
 */
function Glyph({ children, className = "h-3.5 w-3.5", filled }: GlyphProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill={filled ? "currentColor" : "none"}
      focusable="false"
      stroke={filled ? "none" : "currentColor"}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.6}
      viewBox="0 0 16 16"
    >
      {children}
    </svg>
  );
}

export function ChevronLeft({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M10 3.5 5.5 8l4.5 4.5" />
    </Glyph>
  );
}

export function ChevronsLeft({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8.5 3.5 4 8l4.5 4.5" />
      <path d="M13 3.5 8.5 8l4.5 4.5" />
    </Glyph>
  );
}

export function ChevronsRight({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M3 3.5 7.5 8 3 12.5" />
      <path d="M7.5 3.5 12 8l-4.5 4.5" />
    </Glyph>
  );
}

export function Play({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className} filled>
      <path d="M5 3.4v9.2a.5.5 0 0 0 .77.42l7-4.6a.5.5 0 0 0 0-.84l-7-4.6A.5.5 0 0 0 5 3.4Z" />
    </Glyph>
  );
}

export function Pause({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className} filled>
      <rect height="9" rx="0.5" width="3" x="4" y="3.5" />
      <rect height="9" rx="0.5" width="3" x="9" y="3.5" />
    </Glyph>
  );
}

export function Replay({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M13 8a5 5 0 1 1-1.6-3.66" />
      <path d="M13.2 2.6v2.9h-2.9" />
    </Glyph>
  );
}

export function Search({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="7.2" cy="7.2" r="4.6" />
      <path d="m10.6 10.6 3 3" />
    </Glyph>
  );
}

export function Upload({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 10.5V2.2" />
      <path d="M4.8 5.4 8 2.2l3.2 3.2" />
      <path d="M2.6 10v2.4a1.4 1.4 0 0 0 1.4 1.4h8a1.4 1.4 0 0 0 1.4-1.4V10" />
    </Glyph>
  );
}

export function Sun({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="3.1" />
      <path d="M8 1.4v1.6M8 13v1.6M2.3 2.3l1.2 1.2M12.5 12.5l1.2 1.2M1.4 8h1.6M13 8h1.6M2.3 13.7l1.2-1.2M12.5 3.5l1.2-1.2" />
    </Glyph>
  );
}

export function Moon({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M13.4 9.4A5.8 5.8 0 0 1 6.1 2.4a5.9 5.9 0 1 0 7.3 7Z" />
    </Glyph>
  );
}

export function Warning({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M8 2.8 1.9 13.2h12.2L8 2.8Z" />
      <path d="M8 6.6v3" />
      <path d="M8 11.4h.01" />
    </Glyph>
  );
}

export function Close({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M4 4l8 8" />
      <path d="M12 4l-8 8" />
    </Glyph>
  );
}

/** Build mode: a brick being set down. */
export function Brick({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.5 7.5h11v5h-11z" />
      <path d="M5 7.5v-2h2v2M9 7.5v-2h2v2" />
    </Glyph>
  );
}

/** Watch mode: the model playing itself out. */
export function Eye({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M1.5 8s2.5-4 6.5-4 6.5 4 6.5 4-2.5 4-6.5 4-6.5-4-6.5-4Z" />
      <circle cx="8" cy="8" r="1.8" />
    </Glyph>
  );
}

/** Highlight the pieces this step still needs. */
export function Target({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="1.8" />
    </Glyph>
  );
}

/** Start the build again from the first step. */
export function Restart({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M13 8a5 5 0 1 1-1.6-3.7" />
      <path d="M13.2 2.6v2.8h-2.8" />
    </Glyph>
  );
}

/** Progress written to disk. */
export function Save({ className = "h-3.5 w-3.5" }: IconProps) {
  return (
    <Glyph className={className}>
      <path d="M2.5 3.5h8L13.5 6v6.5h-11z" />
      <path d="M5 3.5v3h5" />
    </Glyph>
  );
}
