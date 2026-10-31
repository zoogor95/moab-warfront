import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  question: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}

/**
 * A button that asks first, in the page: browser dialogs are blocked in embeds (Discord,
 * artifacts). Focus moves to the safe choice and comes back when the prompt closes.
 */
export function ConfirmButton({ label, question, confirmLabel, cancelLabel = 'Stay', onConfirm, className = 'btn ghost', disabled }: Props) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const id = useRef(`confirm-${Math.random().toString(36).slice(2, 8)}`).current;
  useEffect(() => {
    if (open) cancelRef.current?.focus();
    else if (wasOpen.current) buttonRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  return (
    <div className="confirm-anchor">
      <button type="button" className={className} ref={buttonRef} aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <div className="confirm" role="group" aria-labelledby={id} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))}>
          <p id={id}>{question}</p>
          <div className="confirm-actions">
            <button type="button" className="btn danger" onClick={() => (setOpen(false), onConfirm())}>{confirmLabel}</button>
            <button type="button" className="btn" ref={cancelRef} onClick={() => setOpen(false)}>{cancelLabel}</button>
          </div>
        </div>
      )}
    </div>
  );
}
