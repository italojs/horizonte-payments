import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return <dialog ref={ref} aria-labelledby="dialog-title" onCancel={event => { event.preventDefault(); close() }}>
    <div className="dialog-head">
      <h2 id="dialog-title">{title}</h2>
      <button className="close" aria-label="Close" onClick={close}>×</button>
    </div>
    {children}
  </dialog>
}
