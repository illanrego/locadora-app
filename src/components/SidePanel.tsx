import type { DiscoveryTitle } from '../domain/content';
import { copy, type Locale } from '../locadora/catalog';
import { Modal } from './Modal';

interface SidePanelProps {
  kind: 'basket' | 'saved' | 'account';
  locale: Locale;
  basket: DiscoveryTitle[];
  onRemove: (title: DiscoveryTitle) => void;
  onClose: () => void;
}

export function SidePanel({ kind, locale, basket, onRemove, onClose }: SidePanelProps) {
  const t = copy[locale];
  const heading = kind === 'basket' ? t.basket : kind === 'saved' ? (locale === 'pt-BR' ? 'Salvos' : 'Saved') : t.account;
  return (
    <Modal label={heading} onClose={onClose} className="side-modal">
      <header className="panel-header">
        <p className="eyebrow">Will's Locadora</p>
        <h2>{heading}</h2>
        <button type="button" className="dialog-close" onClick={onClose} aria-label={t.close}>×</button>
      </header>
      {kind === 'basket' ? (
        <>
          <p>{t.basketHint}</p>
          {basket.length ? (
            <ol className="basket-list">
              {basket.map((title) => (
                <li key={title.identity.canonicalKey}>
                  <span><strong>{title.name}</strong><small>{title.year ?? '—'}</small></span>
                  <button type="button" onClick={() => onRemove(title)}>{t.removeBasket}</button>
                </li>
              ))}
            </ol>
          ) : <p className="panel-empty">{t.basketEmpty}</p>}
          <button type="button" className="counter-action" disabled={!basket.length}>{t.counter} · {t.development}</button>
          <p className="phase-note">{t.checkoutLater}</p>
        </>
      ) : (
        <div className="phase-placeholder">
          <span aria-hidden="true">▣</span>
          <p>{kind === 'saved' ? t.savedLater : t.accountLater}</p>
        </div>
      )}
    </Modal>
  );
}
