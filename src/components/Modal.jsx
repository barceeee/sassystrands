import { useEffect, useId, useRef } from 'react'

// Glass modal built on the native <dialog>: focus trapping, Esc to close and the top layer
// come from the browser. The glass comes from the theme (.modal → raised variant in glass.css).
//
//   <Modal open={open} onClose={() => setOpen(false)} title="Discard changes?"
//          footer={<><button onClick={…}>Keep editing</button><button className="primary">Discard</button></>}>
//     The draft order will be removed.
//   </Modal>
export default function Modal({ open, onClose, title, children, footer, className = '' }) {
  const ref = useRef(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  // Esc fires `cancel`; let the parent own the open state.
  const cancel = (e) => {
    e.preventDefault()
    onClose?.()
  }
  // A click whose target is the <dialog> itself landed on the backdrop.
  const backdropClick = (e) => {
    if (e.target === ref.current) onClose?.()
  }

  return (
    <dialog ref={ref} className={`modal ${className}`} aria-labelledby={title ? titleId : undefined} onCancel={cancel} onClick={backdropClick}>
      {title && (
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </div>
      )}
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </dialog>
  )
}
