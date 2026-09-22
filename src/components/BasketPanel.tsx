import { useEffect, useMemo, useState } from 'react';
import { externalId, type DiscoveryTitle } from '../domain/content';
import { normalizeMemberState } from '../member/memberState';
import { createMemberRental, fetchMemberState, readMemberSession } from '../platform/nativeBridge';
import { copy, type Locale } from '../locadora/catalog';

interface BasketPanelProps {
  locale: Locale;
  basket: DiscoveryTitle[];
  onRemove: (title: DiscoveryTitle) => void;
  onComplete: (rented: DiscoveryTitle[]) => void;
  onOpenAccount: () => void;
}

function causeMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function BasketPanel({ locale, basket, onRemove, onComplete, onOpenAccount }: BasketPanelProps) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [needsAccount, setNeedsAccount] = useState(false);
  const [complete, setComplete] = useState(false);
  const [excluded, setExcluded] = useState<string[]>([]);
  const t = copy[locale];
  const pt = locale === 'pt-BR';

  // Every tape starts selected; the counter only rents what stays selected.
  useEffect(() => {
    setExcluded((current) => current.filter((key) => basket.some((title) => title.identity.canonicalKey === key)));
  }, [basket]);

  const selected = useMemo(
    () => basket.filter((title) => !excluded.includes(title.identity.canonicalKey)),
    [basket, excluded],
  );

  const toggleSelection = (title: DiscoveryTitle) => {
    const key = title.identity.canonicalKey;
    setExcluded((current) => current.includes(key)
      ? current.filter((item) => item !== key)
      : [...current, key]);
  };

  async function checkout() {
    setBusy(true);
    setStatus('');
    setNeedsAccount(false);
    try {
      const session = await readMemberSession();
      if (!session.signedIn) {
        setNeedsAccount(true);
        setStatus(pt ? 'Entre na sua Carteirinha para alugar.' : 'Sign in to your membership to rent.');
        return;
      }
      const before = normalizeMemberState(await fetchMemberState());
      if (!before.profile) {
        setNeedsAccount(true);
        setStatus(pt ? 'Conclua seu nome público antes de alugar.' : 'Finish your public username before renting.');
        return;
      }
      if ((before.activeRental?.items.length ?? 0) + selected.length > 3) {
        setStatus(pt ? 'Devolva uma fita antes: são no máximo 3 aluguéis ativos.' : 'Return a tape first: at most 3 rentals can be active.');
        return;
      }
      const titles = selected.map((title) => ({
        tmdbId: Number(externalId(title.identity, 'tmdb')),
        contentType: title.identity.type,
        name: title.name,
        year: title.year,
      }));
      await createMemberRental(titles);
      await fetchMemberState();
      onComplete(selected);
      setComplete(true);
      setStatus(pt ? 'Aluguel confirmado. Boa sessão!' : 'Rental confirmed. Enjoy the show!');
    } catch (cause) {
      setStatus(causeMessage(cause, pt ? 'Não foi possível concluir o aluguel.' : 'Could not complete the rental.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="basket-panel">
      <p>{t.basketHint}</p>
      {basket.length ? (
        <>
          <p className="basket-rent-hint">{t.rentHint}</p>
          <ol className="basket-list">
            {basket.map((title) => {
              const key = title.identity.canonicalKey;
              const picked = !excluded.includes(key);
              return (
                <li key={key}>
                  <label className="basket-pick">
                    <input
                      type="checkbox"
                      checked={picked}
                      disabled={busy}
                      aria-label={pt ? `${title.name} — escolher para alugar` : `${title.name} — choose to rent`}
                      onChange={() => toggleSelection(title)}
                    />
                    <span><strong>{title.name}</strong><small>{title.year ?? '—'}</small></span>
                  </label>
                  <button type="button" disabled={busy} onClick={() => onRemove(title)}>{t.removeBasket}</button>
                </li>
              );
            })}
          </ol>
        </>
      ) : <p className="panel-empty">{complete ? (pt ? 'As fitas já estão na sua conta.' : 'The tapes are now in your account.') : t.basketEmpty}</p>}
      <button type="button" className="counter-action" disabled={!selected.length || busy} onClick={() => void checkout()}>
        {busy
          ? (pt ? 'Alugando…' : 'Renting…')
          : `${t.rent}${selected.length ? ` ${selected.length}` : ''}`}
      </button>
      {status && <p className={complete ? 'member-success' : 'configuration-status'} role="status">{status}</p>}
      {needsAccount && <button type="button" className="text-action" onClick={onOpenAccount}>{pt ? 'Abrir Carteirinha' : 'Open membership'}</button>}
      <p className="phase-note">{pt ? 'O aluguel não inicia nem altera a reprodução.' : 'Renting does not start or alter playback.'}</p>
    </div>
  );
}
