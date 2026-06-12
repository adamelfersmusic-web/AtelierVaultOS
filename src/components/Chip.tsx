import type { ChipColor, FieldDef } from '../lib/types'

export function chipFor(
  field: FieldDef,
  value: unknown,
): { label: string; color: ChipColor; empty: boolean } {
  if (value === undefined || value === null || value === '') {
    return { label: '—', color: 'dim', empty: true }
  }
  const raw = field.kind === 'bool' ? String(value === true) : String(value)
  const opt = field.options?.find((o) => o.value === raw)
  const label = opt?.label ?? field.format?.(value) ?? raw
  const color = opt?.color ?? field.colorOf?.(value) ?? 'neutral'
  return { label, color, empty: false }
}

export function Chip({
  color,
  label,
  empty,
  size,
}: {
  color: ChipColor
  label: string
  empty?: boolean
  size?: 'sm'
}) {
  return (
    <span
      className={`chip chip-${color}${empty ? ' chip-empty' : ''}${size ? ` chip-${size}` : ''}`}
    >
      <i className="chip-dot" />
      {label}
    </span>
  )
}

export function FieldChip({ field, value }: { field: FieldDef; value: unknown }) {
  const { label, color, empty } = chipFor(field, value)
  return <Chip color={color} label={label} empty={empty} />
}
