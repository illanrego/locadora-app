import { useEffect, useRef, type ReactNode, type DOMAttributes } from 'react';

interface ModalProps extends Pick<DOMAttributes<HTMLDialogElement>, 'onPointerMove' | 'onPointerLeave' | 'onKeyDown' | 'onFocusCapture' | 'onBlurCapture'> {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  onCancel?: () => void;
}

export function Modal({ label, onClose, children, className = '', onCancel, ...events }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    const handleClose = () => onClose();
    dialog.addEventListener('close', handleClose);
    return () => dialog.removeEventListener('close', handleClose);
  }, [onClose]);

  return (
    <dialog
      {...events}
      ref={dialogRef}
      className={`modal ${className}`.trim()}
      aria-label={label}
      onCancel={(event) => { event.preventDefault(); (onCancel ?? onClose)(); }}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      {children}
    </dialog>
  );
}
