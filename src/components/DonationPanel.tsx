import { useRef, useState } from 'react';
import { PUBLIC_PIX_PAYLOAD } from '../locadora/donation';
import type { Locale } from '../locadora/catalog';
import { Modal } from './Modal';

interface DonationPanelProps {
  locale: Locale;
  onClose: () => void;
}

export function DonationPanel({ locale, onClose }: DonationPanelProps) {
  const [status, setStatus] = useState('');
  const payload = useRef<HTMLTextAreaElement>(null);
  const pt = locale === 'pt-BR';

  async function copy() {
    try {
      await navigator.clipboard.writeText(PUBLIC_PIX_PAYLOAD);
      setStatus(pt ? 'Código Pix copiado!' : 'Pix code copied!');
    } catch {
      payload.current?.focus();
      payload.current?.select();
      setStatus(pt ? 'Selecione e copie o código abaixo.' : 'Select and copy the code below.');
    }
  }

  return (
    <Modal label={pt ? 'Me pague um café' : 'Buy me a coffee'} onClose={onClose} className="side-modal donation-modal">
      <header className="panel-header">
        <p className="eyebrow">Will's Locadora</p>
        <h2>{pt ? 'Me pague um café' : 'Buy me a coffee'}</h2>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={pt ? 'Fechar' : 'Close'}>×</button>
      </header>
      <p className="donation-free">{pt ? 'A LOCADORA É GRÁTIS' : 'THE LOCADORA IS FREE'}</p>
      <p>{pt ? 'Não precisa rebobinar, nem pagar, mas se quiser pode me pagar um café.' : 'No need to rewind or pay, but if you want, you can buy me a coffee.'}</p>
      <label className="pix-label" htmlFor="public-pix-payload">{pt ? 'Pix copia e cola' : 'Pix copy-and-paste code'}</label>
      <textarea ref={payload} id="public-pix-payload" rows={4} value={PUBLIC_PIX_PAYLOAD} readOnly spellCheck={false} />
      <button type="button" className="primary-action" onClick={() => void copy()}>{pt ? 'Copiar código Pix' : 'Copy Pix code'}</button>
      <p className="configuration-status" role="status">{status}</p>
      <p className="member-privacy">{pt ? 'A Locadora não recebe nem guarda confirmação de pagamento.' : 'The Locadora does not receive or store payment confirmation.'}</p>
    </Modal>
  );
}
