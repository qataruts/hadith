/** Inline SVG icon set — one consistent 24×24 stroke family, `currentColor`.
 * No emoji anywhere in the UI; every glyph is a real vector icon. */

const svg = (body, { size = 18, sw = 1.6, fill = "none", cls = "" } = {}) =>
  `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}"
    stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">${body}</svg>`;

/** The brand mark: a pointed mihrab arch (the الجامع / mosque) enclosing three
 * isnad threads converging to a single node (the gathering of the chains). */
export const logoMark = (size = 30) => `
  <svg class="brand-mark" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false">
    <path d="M5 21V11C5 6.5 7.6 4 12 3c4.4 1 7 3.5 7 8v10"/>
    <path d="M8.6 20L12 9.4M12 20V9.4M15.4 20L12 9.4"/>
    <circle cx="12" cy="9" r="1.15" fill="currentColor" stroke="none"/>
  </svg>`;

// ── UI icons ────────────────────────────────────────────────────────────────
export const icon = {
  // corpus scope — a book / collection
  scope: (o) => svg(`<path d="M4 5.5A1.5 1.5 0 015.5 4H11v15H5.5A1.5 1.5 0 014 17.5z"/>
    <path d="M20 5.5A1.5 1.5 0 0018.5 4H13v15h5.5a1.5 1.5 0 001.5-1.5z"/><path d="M12 5v13"/>`, o),
  // research chat — speech bubble with a spark
  chat: (o) => svg(`<path d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v9a1.5 1.5 0 01-1.5 1.5H9l-4 3.5V16H5.5A1.5 1.5 0 014 14.5z"/>
    <path d="M12 8v4M10 10h4"/>`, o),
  sun: (o) => svg(`<circle cx="12" cy="12" r="4.2"/>
    <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"/>`, o),
  moon: (o) => svg(`<path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z"/>`, o),
  expand: (o) => svg(`<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>`, o),
  fit: (o) => svg(`<path d="M9 4H5.5A1.5 1.5 0 004 5.5V9M15 4h3.5A1.5 1.5 0 0120 5.5V9M9 20H5.5A1.5 1.5 0 014 18.5V15M15 20h3.5a1.5 1.5 0 001.5-1.5V15"/>`, o),
  close: (o) => svg(`<path d="M6 6l12 12M18 6L6 18"/>`, o),
  check: (o) => svg(`<path d="M4.5 12.5l5 5 10-11"/>`, o),
  warn: (o) => svg(`<path d="M12 4L2.5 20h19z"/><path d="M12 10v4M12 17.5v.5"/>`, o),
  cut: (o) => svg(`<path d="M6 6l12 12M6 18L18 6"/><circle cx="8" cy="8" r="2.4"/><circle cx="8" cy="16" r="2.4"/>`, o),
  node: (o) => svg(`<circle cx="12" cy="12" r="3.4"/><path d="M12 4v4.6M12 15.4V20M4 12h4.6M15.4 12H20"/>`, o),
  search: (o) => svg(`<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.5 4.5"/>`, o),
};
