import { type FormEvent, useEffect, useState } from 'react';
import type { DiscoveryTitle } from '../domain/content';
import { memberDiscoveryTitle, normalizeMemberHistoryPage, normalizeMemberState, type MemberState, type MemberTitle } from '../member/memberState';
import {
  fetchMemberState,
  fetchMemberHistory,
  readMemberSession,
  signInMember,
  signOutMember,
  signUpMember,
  returnMemberRental,
  type MemberSessionStatus,
  updateMemberProfile,
  updateMemberRentalLimit,
} from '../platform/nativeBridge';
import type { Locale } from '../locadora/catalog';
import { TitleReviews } from './TitleReviews';

interface MemberPanelProps {
  locale: Locale;
  onInspect: (title: DiscoveryTitle) => void;
}

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function formatDate(value: string | null, locale: Locale): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function MemberTitleLink({ item, locale, onInspect }: { item: MemberTitle; locale: Locale; onInspect: (title: DiscoveryTitle) => void }) {
  const title = memberDiscoveryTitle(item);
  return <button type="button" className="member-title-link" disabled={!title}
    aria-label={locale === 'pt-BR' ? `Inspecionar ${item.name}` : `Inspect ${item.name}`}
    onClick={() => { if (title) onInspect(title); }}>{item.name}</button>;
}

function TapeList({ items, locale, empty, onInspect }: { items: MemberTitle[]; locale: Locale; empty: string; onInspect: (title: DiscoveryTitle) => void }) {
  if (!items.length) return <p className="member-empty">{empty}</p>;
  return (
    <ul className="member-tape-list">
      {items.map((item) => (
        <li key={item.id}>
          <span><MemberTitleLink item={item} locale={locale} onInspect={onInspect} /><small>{item.year ?? '—'} · {item.type === 'movie' ? (locale === 'pt-BR' ? 'filme' : 'movie') : (locale === 'pt-BR' ? 'série' : 'series')}</small></span>
          {item.unavailable && <em>{locale === 'pt-BR' ? 'fora do acervo' : 'unavailable'}</em>}
        </li>
      ))}
    </ul>
  );
}

export function MemberPanel({ locale, onInspect }: MemberPanelProps) {
  const [session, setSession] = useState<MemberSessionStatus | null>(null);
  const [member, setMember] = useState<MemberState | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returningId, setReturningId] = useState('');
  const [reviewItem, setReviewItem] = useState<MemberTitle | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [collection, setCollection] = useState<'watchLater' | 'favorites' | null>(null);
  const pt = locale === 'pt-BR';

  async function loadState() {
    const value = await fetchMemberState();
    setMember(normalizeMemberState(value));
  }

  useEffect(() => {
    let active = true;
    void readMemberSession()
      .then(async (next) => {
        if (!active) return;
        setSession(next);
        if (next.user?.username) setProfileUsername(next.user.username);
        if (next.signedIn) {
          const value = await fetchMemberState();
          if (active) setMember(normalizeMemberState(value));
        }
      })
      .catch((cause) => {
        if (active) {
          setSession({ configured: true, signedIn: false, user: null });
          setError(messageFrom(cause, pt ? 'Não foi possível abrir sua Carteirinha.' : 'Could not open your membership.'));
        }
      });
    return () => { active = false; };
  }, [pt]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (signup && password !== passwordConfirmation) {
        throw new Error(pt ? 'As senhas precisam ser iguais.' : 'Passwords must match.');
      }
      const next = signup
        ? await signUpMember(identifier.trim(), signupUsername.trim().toLowerCase(), password)
        : await signInMember(identifier.trim(), password);
      setSession(next);
      setPassword('');
      setPasswordConfirmation('');
      if (signup) {
        setProfileUsername(signupUsername.trim().toLowerCase());
        try {
          await updateMemberProfile(signupUsername.trim().toLowerCase());
        } finally {
          await loadState();
        }
      } else {
        await loadState();
      }
    } catch (cause) {
      setError(messageFrom(cause, pt ? 'Não foi possível entrar.' : 'Could not sign in.'));
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const next = await signOutMember();
      setSession(next);
      setMember(null);
      setIdentifier('');
      setPassword('');
      setPasswordConfirmation('');
      setSignupUsername('');
    } catch (cause) {
      setError(messageFrom(cause, pt ? 'Não foi possível sair com segurança.' : 'Could not sign out safely.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await updateMemberProfile(profileUsername.trim().toLowerCase());
      await loadState();
    } catch (cause) {
      setError(messageFrom(cause, pt ? 'Não foi possível salvar seu nome público.' : 'Could not save your public username.'));
    } finally {
      setBusy(false);
    }
  }

  async function saveRentalLimit(value: number) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await updateMemberRentalLimit(value);
      await loadState();
      setNotice(pt ? 'Limite de aluguéis salvo.' : 'Rental limit saved.');
    } catch (cause) {
      setError(messageFrom(cause, pt ? 'Não foi possível salvar o limite.' : 'Could not save the limit.'));
    } finally {
      setBusy(false);
    }
  }

  async function returnTape(item: MemberTitle, watchedStatus: 'watched' | 'not_watched' | 'unknown') {
    setReturningId(item.id);
    setReviewItem(null);
    setError('');
    setNotice('');
    try {
      await returnMemberRental(item.id, watchedStatus);
      await loadState();
      if (watchedStatus === 'watched') {
        setReviewItem(item);
        setNotice(pt ? 'Fita devolvida. Agora conta o que achou.' : 'Tape returned. Now tell us what you thought.');
      } else {
        setNotice(pt ? 'Fita devolvida e histórico atualizado.' : 'Tape returned and history updated.');
      }
    } catch (cause) {
      setError(messageFrom(cause, pt ? 'Não foi possível devolver a fita.' : 'Could not return the tape.'));
    } finally {
      setReturningId('');
    }
  }

  async function loadMoreHistory() {
    if (!member || !member.historyHasMore) return;
    setHistoryBusy(true);
    setError('');
    setNotice('');
    try {
      const page = normalizeMemberHistoryPage(await fetchMemberHistory(member.history.length));
      setMember((current) => {
        if (!current) return current;
        const existing = new Set(current.history.map((item) => item.id));
        return {
          ...current,
          history: [...current.history, ...page.history.filter((item) => !existing.has(item.id))],
          historyHasMore: page.hasMore,
        };
      });
    } catch (cause) {
      setError(messageFrom(cause, pt ? 'Não foi possível carregar mais histórico.' : 'Could not load more history.'));
    } finally {
      setHistoryBusy(false);
    }
  }

  if (session === null) return <p className="configuration-status" role="status">{pt ? 'Abrindo sua Carteirinha…' : 'Opening your membership…'}</p>;

  if (!session.configured) {
    return (
      <div className="phase-placeholder">
        <span aria-hidden="true">▣</span>
        <p>{pt ? 'Abra o aplicativo desktop para entrar na sua Locadora.' : 'Open the desktop app to sign in to your Locadora.'}</p>
      </div>
    );
  }

  if (!session.signedIn) {
    return (
      <form className="member-sign-in" onSubmit={submit}>
        <p>{signup
          ? (pt ? 'Crie sua Carteirinha para alugar, salvar e avaliar fitas.' : 'Create your membership to rent, save, and review tapes.')
          : (pt ? 'Entre só quando quiser alugar, salvar ou rever seu histórico.' : 'Sign in only when you want to rent, save, or revisit your history.')}</p>
        <label htmlFor="member-identifier">{signup ? 'Email' : (pt ? 'Email ou nome de usuário' : 'Email or username')}</label>
        <input id="member-identifier" type={signup ? 'email' : 'text'} value={identifier} onChange={(event) => setIdentifier(event.target.value)} autoComplete={signup ? 'email' : 'username'} minLength={3} maxLength={254} required />
        {signup && (
          <>
            <label htmlFor="member-signup-username">{pt ? 'Nome público' : 'Public username'}</label>
            <input id="member-signup-username" value={signupUsername} onChange={(event) => setSignupUsername(event.target.value)} autoComplete="nickname" minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]{3,24}" required />
          </>
        )}
        <label htmlFor="member-password">{pt ? 'Senha' : 'Password'}</label>
        <input id="member-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={signup ? 'new-password' : 'current-password'} minLength={6} maxLength={128} required />
        {signup && (
          <>
            <label htmlFor="member-password-confirmation">{pt ? 'Confirmar senha' : 'Confirm password'}</label>
            <input id="member-password-confirmation" type="password" value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={6} maxLength={128} required />
          </>
        )}
        {error && <p className="member-error" role="alert">{error}</p>}
        <button type="submit" className="primary-action" disabled={busy}>{busy
          ? (signup ? (pt ? 'Criando…' : 'Creating…') : (pt ? 'Entrando…' : 'Signing in…'))
          : (signup ? (pt ? 'Criar Carteirinha' : 'Create membership') : (pt ? 'Entrar' : 'Sign in'))}</button>
        <button type="button" className="text-action" disabled={busy} onClick={() => { setSignup((current) => !current); setError(''); setPassword(''); setPasswordConfirmation(''); }}>
          {signup ? (pt ? 'Já tenho conta' : 'I already have an account') : (pt ? 'Criar conta' : 'Create account')}
        </button>
        <p className="member-privacy">{pt ? 'A sessão fica no cofre do sistema e nunca é compartilhada com suas fontes de mídia.' : 'Your session stays in the system vault and is never shared with media sources.'}</p>
      </form>
    );
  }

  const username = member?.profile?.username ?? session.user?.username ?? (pt ? 'membro' : 'member');
  const savedCount = new Set([
    ...(member?.collections.watchLater ?? []).map((item) => item.canonicalKey),
    ...(member?.collections.favorites ?? []).map((item) => item.canonicalKey),
  ]).size;

  if (collection && member) return <section className="member-section">
    <button type="button" onClick={() => setCollection(null)}>{pt ? 'Voltar à Carteirinha' : 'Back to membership'}</button>
    <h3>{collection === 'watchLater' ? (pt ? 'Salvas para depois' : 'Saved for later') : (pt ? 'Favoritas' : 'Favorites')}</h3>
    <TapeList onInspect={onInspect} items={member.collections[collection]} locale={locale} empty={pt ? 'Nenhuma fita nesta lista.' : 'No tapes in this list.'} />
  </section>;

  return (
    <div className="member-overview">
      <div className="membership-card">
        <span>{pt ? 'CARTEIRINHA' : 'MEMBERSHIP'}</span>
        <strong>@{username}</strong>
        <small>{pt ? 'desde' : 'since'} {formatDate(member?.profile?.createdAt ?? null, locale)}</small>
      </div>
      {error && <p className="member-error" role="alert">{error}</p>}
      {notice && <p className="member-success" role="status">{notice}</p>}
      {!member ? (
        <button type="button" disabled={busy} onClick={() => { setBusy(true); setError(''); void loadState().catch((cause) => setError(messageFrom(cause, pt ? 'Não foi possível carregar sua conta.' : 'Could not load your account.'))).finally(() => setBusy(false)); }}>{pt ? 'Tentar novamente' : 'Try again'}</button>
      ) : !member.profile ? (
        <form className="member-sign-in member-profile-form" onSubmit={saveProfile}>
          <p>{pt ? 'Escolha seu nome público para terminar a Carteirinha.' : 'Choose your public username to finish your membership.'}</p>
          <label htmlFor="member-profile-username">{pt ? 'Nome público' : 'Public username'}</label>
          <input id="member-profile-username" value={profileUsername} onChange={(event) => setProfileUsername(event.target.value)} autoComplete="nickname" minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]{3,24}" required />
          <button type="submit" className="primary-action" disabled={busy}>{busy ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Concluir Carteirinha' : 'Finish membership')}</button>
        </form>
      ) : (
        <>
          <label htmlFor="member-rental-limit">{pt ? 'Limite de aluguéis simultâneos' : 'Simultaneous rental limit'}</label>
          <select id="member-rental-limit" value={member.profile.rentalLimit} disabled={busy} onChange={(event) => void saveRentalLimit(Number(event.target.value))}>
            {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
          </select>
          <p className="member-privacy">{pt ? 'Vale para o aplicativo e o site. Reduzir o limite não devolve suas fitas atuais.' : 'Applies to the app and website. Lowering the limit does not return existing rentals.'}</p>
          <dl className="member-counts">
            <div><dt>{pt ? 'Ativas' : 'Active'}</dt><dd>{member.activeRental?.items.length ?? 0}/{member.profile.rentalLimit}</dd></div>
            <div><dt>{pt ? 'Salvas' : 'Saved'}</dt><dd>{savedCount}</dd></div>
            <div><dt>{pt ? 'Devolvidas' : 'Returned'}</dt><dd>{member.history.length}{member.historyHasMore ? '+' : ''}</dd></div>
          </dl>
          <section className="member-section">
            <h3>{pt ? 'Com você agora' : 'With you now'}</h3>
            {member.activeRental?.items.length ? (
              <ul className="member-tape-list member-return-list">
                {member.activeRental.items.map((item) => (
                  <li key={item.id}>
                    <span><MemberTitleLink item={item} locale={locale} onInspect={onInspect} /><small>{item.year ?? '—'}</small></span>
                    <div className="return-actions" aria-label={pt ? `Devolver ${item.name}` : `Return ${item.name}`}>
                      <button type="button" disabled={returningId === item.id} onClick={() => void returnTape(item, 'watched')}>{pt ? 'Assisti' : 'Watched'}</button>
                      <button type="button" disabled={returningId === item.id} onClick={() => void returnTape(item, 'not_watched')}>{pt ? 'Não assisti' : 'Not watched'}</button>
                      <button type="button" disabled={returningId === item.id} onClick={() => void returnTape(item, 'unknown')}>{pt ? 'Não dizer' : 'Skip'}</button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="member-empty">{pt ? 'Nenhuma fita alugada agora.' : 'No tapes currently rented.'}</p>}
          </section>
          {reviewItem && (
            <section className="member-section return-review" aria-label={pt ? `Avaliação de ${reviewItem.name}` : `Review ${reviewItem.name}`}>
              <h3>{pt ? `O que achou de ${reviewItem.name}?` : `What did you think of ${reviewItem.name}?`}</h3>
              <p>{pt ? 'Você marcou esta devolução como assistida. Registre sua avaliação agora.' : 'You marked this return as watched. Share your review now.'}</p>
              <TitleReviews contentType={reviewItem.type} tmdbId={reviewItem.tmdbId} locale={locale} />
            </section>
          )}
          <section className="member-section">
            <h3>{pt ? 'Salvas para depois' : 'Saved for later'}</h3>
            <TapeList onInspect={onInspect} items={member.collections.watchLater.slice(0, 3)} locale={locale} empty={pt ? 'Nenhuma fita salva.' : 'No saved tapes.'} />
            <button type="button" onClick={() => setCollection('watchLater')}>{pt ? 'Abrir Assistir depois' : 'Open Watch later'} ({member.collections.watchLater.length})</button>
          </section>
          <section className="member-section">
            <h3>{pt ? 'Favoritas' : 'Favorites'}</h3>
            <TapeList onInspect={onInspect} items={member.collections.favorites.slice(0, 3)} locale={locale} empty={pt ? 'Nenhuma fita favorita.' : 'No favorite tapes.'} />
            <button type="button" onClick={() => setCollection('favorites')}>{pt ? 'Abrir Favoritas' : 'Open Favorites'} ({member.collections.favorites.length})</button>
          </section>
          <section className="member-section">
            <h3>{pt ? 'Últimas devoluções' : 'Recent returns'}</h3>
            <TapeList onInspect={onInspect} items={member.history} locale={locale} empty={pt ? 'Seu histórico ainda está vazio.' : 'Your history is still empty.'} />
            {member.historyHasMore && <button type="button" className="history-more" disabled={historyBusy} onClick={() => void loadMoreHistory()}>{historyBusy ? (pt ? 'Buscando…' : 'Loading…') : (pt ? 'Mais histórico' : 'More history')}</button>}
          </section>
        </>
      )}
      <button type="button" className="text-action" disabled={busy} onClick={() => void signOut()}>{pt ? 'Sair da Locadora' : 'Sign out of Locadora'}</button>
    </div>
  );
}
