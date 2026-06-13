// Hand-drawn 16px inline icons — one stroke weight, no icon kit.

import type { ReactNode } from 'react'

interface IconProps {
  size?: number
  className?: string
}

function svg(
  path: ReactNode,
  { size = 16, className }: IconProps = {},
  viewBox = '0 0 16 16',
) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {path}
    </svg>
  )
}

export const IconScripts = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M4 2.5h6.5L13 5v8.5H4z" />
      <path d="M6.2 6.5h3.6M6.2 9h3.6M6.2 11.5h2.2" />
    </>,
    p,
  )

export const IconGraph = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="4" cy="11.5" r="2" />
      <circle cx="11.8" cy="3.8" r="1.8" />
      <circle cx="12.2" cy="12.2" r="1.4" />
      <circle cx="6.8" cy="5.2" r="1.1" />
      <path d="M5.5 10.2 6.4 6.3M7.9 4.9l2.2-.7M5.9 11.1l4.9 .9M12 5.6l.2 5.2" />
    </>,
    p,
  )

export const IconLibrary = (p: IconProps = {}) =>
  svg(
    <>
      <circle cx="7" cy="7" r="4.2" />
      <path d="M10.2 10.2 13.5 13.5" />
    </>,
    p,
  )

export const IconPlus = (p: IconProps = {}) =>
  svg(<path d="M8 3.2v9.6M3.2 8h9.6" />, p)

export const IconTable = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="2.5" y="3" width="11" height="10" rx="1.2" />
      <path d="M2.5 6.4h11M6.6 6.4V13" />
    </>,
    p,
  )

export const IconBoard = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="2.5" y="3" width="3.2" height="10" rx="0.8" />
      <rect x="6.9" y="3" width="3.2" height="7" rx="0.8" />
      <rect x="11.3" y="3" width="2.2" height="8.5" rx="0.8" />
    </>,
    p,
  )

export const IconGallery = (p: IconProps = {}) =>
  svg(
    <>
      <rect x="2.5" y="2.5" width="4.6" height="4.6" rx="0.9" />
      <rect x="8.9" y="2.5" width="4.6" height="4.6" rx="0.9" />
      <rect x="2.5" y="8.9" width="4.6" height="4.6" rx="0.9" />
      <rect x="8.9" y="8.9" width="4.6" height="4.6" rx="0.9" />
    </>,
    p,
  )

export const IconBack = (p: IconProps = {}) =>
  svg(<path d="M9.8 3.5 5.3 8l4.5 4.5" />, p)

export const IconEdit = (p: IconProps = {}) =>
  svg(
    <>
      <path d="m9.6 3.4 3 3L6 13l-3.4.4L3 10z" />
      <path d="m8.4 4.6 3 3" />
    </>,
    p,
  )

export const IconShield = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M8 1.8 13 3.6v4.2c0 3.4-2.2 5.4-5 6.4-2.8-1-5-3-5-6.4V3.6z" />
      <circle cx="8" cy="7.4" r="1.1" fill="currentColor" stroke="none" />
    </>,
    p,
  )

export const IconClose = (p: IconProps = {}) =>
  svg(<path d="M4 4l8 8M12 4l-8 8" />, p)

export const IconFilter = (p: IconProps = {}) =>
  svg(<path d="M2.5 4h11M4.8 8h6.4M6.8 12h2.4" />, p)

export const IconSort = (p: IconProps = {}) =>
  svg(<path d="M5 3v10M5 13l-2.4-2.4M5 13l2.4-2.4M11 13V3M11 3 8.6 5.4M11 3l2.4 2.4" />, p)

export const IconCheck = (p: IconProps = {}) =>
  svg(<path d="m3.2 8.6 3 3 6.6-7.2" />, p)

export const IconSpark = (p: IconProps = {}) =>
  svg(
    <path d="M8 2.2 9.5 6.5 13.8 8 9.5 9.5 8 13.8 6.5 9.5 2.2 8 6.5 6.5z" />,
    p,
  )

export const IconLink = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M6.5 9.5 9.5 6.5" />
      <path d="M7.5 4.7 9 3.2a2.6 2.6 0 0 1 3.8 3.8l-1.5 1.5" />
      <path d="M8.5 11.3 7 12.8a2.6 2.6 0 0 1-3.8-3.8l1.5-1.5" />
    </>,
    p,
  )

export const IconRefresh = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M13 8a5 5 0 1 1-1.5-3.6" />
      <path d="M13 2.8v2.6h-2.6" />
    </>,
    p,
  )

export const IconDisconnect = (p: IconProps = {}) =>
  svg(
    <>
      <path d="M6.5 5.5v-2A1.5 1.5 0 0 1 8 2h4a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 12 14H8a1.5 1.5 0 0 1-1.5-1.5v-2" />
      <path d="M2.5 8h7M9.5 8 7.3 5.8M9.5 8l-2.2 2.2" />
    </>,
    p,
  )
