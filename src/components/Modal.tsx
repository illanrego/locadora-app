import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  onCancel?: () => void;
}

export function Modal({ label, onClose, children, className = '', onCancel }: ModalProps) {
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
