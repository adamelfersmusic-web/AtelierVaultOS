import { cleanPreview } from '../lib/format'
import { isProtectedNote } from '../domain/scripts'
import { FieldChip } from '../components/Chip'
import { IconShield } from '../components/Icons'
import type { LensProps } from './DatabaseView'

export function GalleryLens({ def, rows, onOpen }: LensProps) {
  const galleryFields = def.gallery.fields
    .map((key) => def.fields.find((f) => f.key === key))
    .filter((f): f is NonNullable<typeof f> => Boolean(f))

  return (
    <div className="gallery">
      {rows.map((row) => {
        const preview = cleanPreview(row.note.preview, row.title)
        return (
          <button key={row.path} className="gcard" onClick={() => onOpen(row.path)}>
            <div className="gcard-title">
              {row.title}
              {isProtectedNote(row.note) && (
                <span className="canon-mini" title="Founder canon — human-gated">
                  <IconShield size={11} />
                </span>
              )}
            </div>
            {preview && <p className="gcard-preview">{preview}</p>}
            <div className="gcard-chips">
              {galleryFields.map((f) => {
                const v = row.note.metadata[f.key]
                if (v == null || v === '') return null
                return <FieldChip key={f.key} field={f} value={v} />
              })}
            </div>
          </button>
        )
      })}
      {rows.length === 0 && (
        <div className="table-empty">Nothing matches the current filters.</div>
      )}
    </div>
  )
}
