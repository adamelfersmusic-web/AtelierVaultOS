import { useMemo, useRef, useState } from 'react'
import type { FieldDef } from '../lib/types'
import { Chip, chipFor, FieldChip } from './Chip'
import { Popover } from './Popover'
import { IconCheck } from './Icons'

/**
 * The options offered for a field: declared options first, then any extra
 * values observed in the dataset (so nothing in the vault is unreachable).
 */
export function optionsFor(field: FieldDef, observed?: Set<string>) {
  const declared = field.options ?? []
  const seen = new Set(declared.map((o) => o.value))
  const extras = [...(observed ?? [])]
    .filter((v) => v !== '' && !seen.has(v))
    .sort()
    .map((value) => ({
      value,
      label: field.format?.(value) ?? value,
      color: field.colorOf?.(value) ?? ('neutral' as const),
    }))
  return [...declared, ...extras]
}

export function EnumMenu({
  field,
  value,
  anchor,
  observed,
  onPick,
  onClose,
}: {
  field: FieldDef
  value: unknown
  anchor: HTMLElement
  observed?: Set<string>
  onPick: (value: unknown) => void
  onClose: () => void
}) {
  const options = useMemo(() => optionsFor(field, observed), [field, observed])
  const current = field.kind === 'bool' ? String(value === true) : String(value ?? '')
  const [custom, setCustom] = useState('')

  const pick = (raw: string) => {
    onClose()
    const next: unknown = field.kind === 'bool' ? raw === 'true' : raw
    if (next !== value) onPick(next)
  }

  return (
    <Popover anchor={anchor} onClose={onClose} width={208}>
      <div className="menu-label">{field.label}</div>
      {options.map((o) => (
        <button
          key={o.value}
          role="menuitem"
          className={`menu-item${o.value === current ? ' is-current' : ''}`}
          onClick={() => pick(o.value)}
        >
          <Chip
            color={o.color}
            label={o.label ?? field.format?.(o.value) ?? o.value}
          />
          {o.value === current && <IconCheck size={14} className="menu-check" />}
        </button>
      ))}
      {field.openEnum && (
        <form
          className="menu-custom"
          onSubmit={(e) => {
            e.preventDefault()
            const v = custom.trim()
            if (v) pick(v)
          }}
        >
          <input
            className="menu-custom-input"
            placeholder="custom value…"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
          />
        </form>
      )}
    </Popover>
  )
}

/** A chip that opens its field's menu on click. */
export function ChipSelect({
  field,
  value,
  observed,
  onPick,
  saving,
  stop = true,
}: {
  field: FieldDef
  value: unknown
  observed?: Set<string>
  onPick: (value: unknown) => void
  saving?: boolean
  stop?: boolean
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const { label, color, empty } = chipFor(field, value)
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`chip-btn${saving ? ' is-saving' : ''}`}
        data-field={field.key}
        aria-label={`${field.label}: ${label}`}
        onClick={(e) => {
          if (stop) e.stopPropagation()
          setOpen(true)
        }}
        onPointerDown={(e) => {
          if (stop) e.stopPropagation()
        }}
      >
        <Chip color={color} label={label} empty={empty} />
      </button>
      {open && ref.current && (
        <EnumMenu
          field={field}
          value={value}
          observed={observed}
          anchor={ref.current}
          onPick={onPick}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

export { FieldChip }
