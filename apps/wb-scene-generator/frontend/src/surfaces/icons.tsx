// 💡 Renderer-local inline SVG icons (lucide-style stroke icons).
//
// The legacy renderer toolbar / layers panel use `lucide-react`. This repo does
// not depend on lucide; rather than pull in a new dependency for the
// scene-generator-local preview window, we hand-port the exact lucide glyph
// paths used by the legacy UI as tiny inline-SVG components. Same visual
// treatment (1.5–2px round stroke, currentColor), zero new deps.

import type { SVGProps } from 'react'

interface IconProps extends SVGProps<SVGSVGElement> {
  size?: number
}

function Icon({ size = 16, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

export const ChevronDown = (p: IconProps) => (
  <Icon {...p}>
    <path d="m6 9 6 6 6-6" />
  </Icon>
)

export const ChevronRight = (p: IconProps) => (
  <Icon {...p}>
    <path d="m9 18 6-6-6-6" />
  </Icon>
)

export const Layers = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
    <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
    <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
  </Icon>
)

export const Folder = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M3 10h16" />
  </Icon>
)

export const History = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
    <path d="M12 7v5l3 2" />
  </Icon>
)

export const CircleHelp = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.7 2.7 0 1 1 4.9 1.6c-.8 1-2.4 1.4-2.4 3" />
    <path d="M12 17h.01" />
  </Icon>
)

export const NodeEditor = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="6" cy="6" r="2" />
    <circle cx="18" cy="7" r="2" />
    <circle cx="12" cy="18" r="2" />
    <path d="M7.8 6.3 16 6.8M7.2 7.7l3.7 8.5M16.8 8.5l-3.7 7.7" />
  </Icon>
)

export const Pin = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 17v5" />
    <path d="M5 17h14" />
    <path d="M15 4.5V2H9v2.5a2 2 0 0 0 .4 1.2L11 7.8V11l-5 4v2h12v-2l-5-4V7.8l1.6-2.1a2 2 0 0 0 .4-1.2Z" />
  </Icon>
)

export const Settings = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

export const SlidersHorizontal = (p: IconProps) => (
  <Icon {...p}>
    <line x1="21" x2="14" y1="4" y2="4" />
    <line x1="10" x2="3" y1="4" y2="4" />
    <line x1="21" x2="12" y1="12" y2="12" />
    <line x1="8" x2="3" y1="12" y2="12" />
    <line x1="21" x2="16" y1="20" y2="20" />
    <line x1="12" x2="3" y1="20" y2="20" />
    <circle cx="12" cy="4" r="2" />
    <circle cx="10" cy="12" r="2" />
    <circle cx="14" cy="20" r="2" />
  </Icon>
)

export const Maximize2 = (p: IconProps) => (
  <Icon {...p}>
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" x2="14" y1="3" y2="10" />
    <line x1="3" x2="10" y1="21" y2="14" />
  </Icon>
)

export const Minimize2 = (p: IconProps) => (
  <Icon {...p}>
    <polyline points="4 14 10 14 10 20" />
    <polyline points="20 10 14 10 14 4" />
    <line x1="14" x2="21" y1="10" y2="3" />
    <line x1="3" x2="10" y1="21" y2="14" />
  </Icon>
)

export const ZoomIn = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" x2="16.65" y1="21" y2="16.65" />
    <line x1="11" x2="11" y1="8" y2="14" />
    <line x1="8" x2="14" y1="11" y2="11" />
  </Icon>
)

export const ZoomOut = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" x2="16.65" y1="21" y2="16.65" />
    <line x1="8" x2="14" y1="11" y2="11" />
  </Icon>
)

export const Home = (p: IconProps) => (
  <Icon {...p}>
    <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </Icon>
)

export const Camera = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
    <circle cx="12" cy="13" r="3" />
  </Icon>
)

export const Eye = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

export const EyeOff = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
    <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
    <line x1="2" x2="22" y1="2" y2="22" />
  </Icon>
)

export const ListTree = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8 6h13" />
    <path d="M8 12h13" />
    <path d="M8 18h13" />
    <path d="M3 6h.01" />
    <path d="M3 12h.01" />
    <path d="M3 18h.01" />
  </Icon>
)

export const Mountain = (p: IconProps) => (
  <Icon {...p}>
    <path d="m8 17 4-6 4 6" />
    <path d="M3 20 9 9l3 4 3-5 6 12" />
  </Icon>
)

export const Box = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" />
    <path d="m3.3 7 8.7 5 8.7-5" />
    <path d="M12 22V12" />
  </Icon>
)

export const Pencil = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
    <path d="m15 5 4 4" />
  </Icon>
)

export const Plus = (p: IconProps) => (
  <Icon {...p}>
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </Icon>
)

export const Upload = (p: IconProps) => (
  <Icon {...p}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="m7 8 5-5 5 5" />
    <path d="M12 3v12" />
  </Icon>
)

export const TriangleAlert = (p: IconProps) => (
  <Icon {...p}>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
)

export const Trash = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 6h18" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </Icon>
)

export const Sliders = (p: IconProps) => (
  <Icon {...p}>
    <line x1="4" x2="4" y1="21" y2="14" />
    <line x1="4" x2="4" y1="10" y2="3" />
    <line x1="12" x2="12" y1="21" y2="12" />
    <line x1="12" x2="12" y1="8" y2="3" />
    <line x1="20" x2="20" y1="21" y2="16" />
    <line x1="20" x2="20" y1="12" y2="3" />
    <line x1="1" x2="7" y1="14" y2="14" />
    <line x1="9" x2="15" y1="8" y2="8" />
    <line x1="17" x2="23" y1="16" y2="16" />
  </Icon>
)

// Minimal viewport glyphs: one silhouette per mode, tuned for 16–18px use.
export const ViewPerspective = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 4 7 4v8l-7 4-7-4V8Z" />
    <path d="m5 8 7 4 7-4M12 12v8" />
  </Icon>
)

export const ViewTop = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="5" width="14" height="14" rx="2" />
    <path d="M12 8v8M8 12h8" />
  </Icon>
)

export const ViewBillboard = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="4" width="12" height="13" rx="1.5" />
    <path d="M12 17v3M7 20h10" />
  </Icon>
)

export const ViewIso = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 4 8 5-8 5-8-5Z" />
    <path d="m4 9v6l8 5 8-5V9M12 14v6" />
  </Icon>
)

export const ViewOrbit = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="2.5" />
    <path d="M4 12a8 6 0 0 1 14-4M20 12a8 6 0 0 1-14 4" />
    <path d="m17 5 1 3-3-1M7 19l-1-3 3 1" />
  </Icon>
)

export const ViewMesh = (p: IconProps) => (
  <Icon {...p}>
    <path d="m12 4 8 16H4Z" />
    <path d="M8 12h8M12 4v16" />
  </Icon>
)

export const Axis3d = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="16" r="1" fill="currentColor" stroke="none" />
    <path d="M8 16V5M8 16l10-6M8 16l7 5" />
  </Icon>
)
