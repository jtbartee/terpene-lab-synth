// Inline SVG icons. Every icon carries explicit width/height so it can never
// inflate to fill a container.

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size: number, props: SVGProps<SVGSVGElement>) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, focusable: false, ...props,
});

export const IconPlay = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" /></svg>;
export const IconPause = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" /></svg>;
export const IconStop = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><rect x="5.5" y="5.5" width="13" height="13" rx="1.5" fill="currentColor" stroke="none" /></svg>;
export const IconRegen = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></svg>;
export const IconDice = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><rect x="4" y="4" width="16" height="16" rx="3" /><circle cx="9" cy="9" r="1.2" fill="currentColor" /><circle cx="15" cy="15" r="1.2" fill="currentColor" /><circle cx="15" cy="9" r="1.2" fill="currentColor" /><circle cx="9" cy="15" r="1.2" fill="currentColor" /></svg>;
export const IconLock = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>;
export const IconUnlock = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></svg>;
export const IconInfo = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.01" /></svg>;
export const IconMute = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 9l4 6M21 9l-4 6" /></svg>;
export const IconSpeaker = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M4 9h4l5-4v14l-5-4H4z" /><path d="M17 8.5a5 5 0 0 1 0 7" /></svg>;
export const IconClose = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M6 6l12 12M18 6L6 18" /></svg>;
export const IconPlus = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M12 5v14M5 12h14" /></svg>;
export const IconSave = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M5 4h11l3 3v13H5z" /><path d="M8 4v5h7V4M8 20v-6h8v6" /></svg>;
export const IconSend = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M4 12h12M12 6l6 6-6 6" /><path d="M20 4v16" /></svg>;
export const IconCopy = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>;
export const IconTrash = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" /></svg>;
export const IconStar = ({ size = 16, filled, ...p }: P & { filled?: boolean }) => <svg {...base(size, p)}><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z" fill={filled ? 'currentColor' : 'none'} /></svg>;
export const IconDownload = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>;
export const IconUpload = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M12 20V9M7 14l5-5 5 5M5 4h14" /></svg>;
export const IconReset = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M4 12a8 8 0 1 0 2.3-5.7" /><path d="M4 4v5h5" /></svg>;
export const IconCompare = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M8 4v16M16 4v16M4 8h4M16 16h4M4 16h4M16 8h4" /></svg>;
export const IconFlask = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /><path d="M7.5 15h9" /></svg>;
export const IconWave = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" /></svg>;
export const IconSearch = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" /></svg>;
export const IconMidi = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><circle cx="12" cy="12" r="8.5" /><circle cx="8" cy="11" r="1" fill="currentColor" /><circle cx="16" cy="11" r="1" fill="currentColor" /><circle cx="12" cy="8" r="1" fill="currentColor" /><circle cx="9.5" cy="14.5" r="1" fill="currentColor" /><circle cx="14.5" cy="14.5" r="1" fill="currentColor" /></svg>;
export const IconAlert = ({ size = 16, ...p }: P) => <svg {...base(size, p)}><path d="M12 4l9 16H3z" /><path d="M12 10v4M12 17v.01" /></svg>;

export function BrandMark({ size = 30 }: { size?: number }) {
  // a terpene-like hexagon with an isoprene tail feeding a sine wave
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <polygon points="10,4 17,8 17,16 10,20 3,16 3,8" fill="none" stroke="#e8a83e" strokeWidth="1.8" />
      <line x1="10" y1="7.2" x2="10" y2="16.8" stroke="#e8a83e" strokeWidth="1.2" opacity="0.6" />
      <path d="M17 12 L21 10" stroke="#e8a83e" strokeWidth="1.8" />
      <path d="M19 22c1.6-4 3.2-4 4.8 0s3.2 4 4.8 0" fill="none" stroke="#9fe57e" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="21" cy="10" r="1.6" fill="#9fe57e" />
    </svg>
  );
}
