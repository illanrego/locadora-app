import type { DiscoveryTitle } from '../domain/content';
import type { LocalSavedCollections, SavedCollection } from '../member/localSaved';
import { copy, type Locale } from '../locadora/catalog';
import { Modal } from './Modal';
import { MemberPanel } from './MemberPanel';
import { SavedPanel } from './SavedPanel';

interface SidePanelProps {
  kind: 'basket' | 'saved' | 'account';
  locale: Locale;
  basket: DiscoveryTitle[];
  saved: LocalSavedCollections;
  onRemove: (title: DiscoveryTitle) => void;
  onSetSaved: (title: DiscoveryTitle, collection: SavedCollection, enabled: boolean) => Promise<boolean>;
  onClose: () => void;
}

export function SidePanel({ kind, locale, basket, saved, onRemove, onSetSaved, onClose }: SidePanelProps) {
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
      ) : kind === 'account' ? (
        <MemberPanel locale={locale} />
      ) : (
        <SavedPanel locale={locale} local={saved} onSet={onSetSaved} />
      )}
    </Modal>
  );
}
