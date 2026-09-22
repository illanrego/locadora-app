import type { DiscoveryTitle } from '../domain/content';
import type { LocalSavedCollections, SavedCollection } from '../member/localSaved';
import { copy, type Locale } from '../locadora/catalog';
import { Modal } from './Modal';
import { MemberPanel } from './MemberPanel';
import { SavedPanel } from './SavedPanel';
import { BasketPanel } from './BasketPanel';

interface SidePanelProps {
  kind: 'basket' | 'saved' | 'account';
  locale: Locale;
  basket: DiscoveryTitle[];
  saved: LocalSavedCollections;
  onRemove: (title: DiscoveryTitle) => void;
  onSetSaved: (title: DiscoveryTitle, collection: SavedCollection, enabled: boolean) => Promise<boolean>;
  onBasketComplete: (rented: DiscoveryTitle[]) => void;
  onOpenAccount: () => void;
  onClose: () => void;
}

export function SidePanel({ kind, locale, basket, saved, onRemove, onSetSaved, onBasketComplete, onOpenAccount, onClose }: SidePanelProps) {
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
        <BasketPanel locale={locale} basket={basket} onRemove={onRemove} onComplete={onBasketComplete} onOpenAccount={onOpenAccount} />
      ) : kind === 'account' ? (
        <MemberPanel locale={locale} />
      ) : (
        <SavedPanel locale={locale} local={saved} onSet={onSetSaved} />
      )}
    </Modal>
  );
}
