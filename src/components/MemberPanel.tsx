import { type FormEvent, useEffect, useState } from 'react';
import { externalId, type DiscoveryTitle } from '../domain/content';
import { readAllSeriesProgress, readLocalSeriesEpisodes } from '../locadora/localCache';
import { memberDiscoveryTitle, normalizeMemberHistoryPage, normalizeMemberState, type MemberState, type MemberTitle } from '../member/memberState';
import { nextEpisode, type BoundedEpisode } from '../media/seriesEpisodes';
import { releaseReturnedTape } from '../rentals/rentalTapePipeline';
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
import { TapeDashboard } from './TapeDashboard';
import { TapeSpaceCeiling } from './TapeSettingsGroup';
import { TitleReviews } from './TitleReviews';

interface MemberPanelProps {
  locale: Locale;
  onInspect: (title: DiscoveryTitle) => void;
  knownTitles?: readonly DiscoveryTitle[];
}

interface ContinueItem {
  title: DiscoveryTitle;
  episode: BoundedEpisode;
}

const EMPTY_TITLES: readonly DiscoveryTitle[] = [];

function messageFrom(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function formatDate(value: string | null, locale: Locale): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}

function episodeLabel(episode: BoundedEpisode): string {
  return `T${String(episode.season).padStart(2, '0')}E${String(episode.episode).padStart(2, '0')}`;
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

export function MemberPanel({ locale, onInspect, knownTitles = EMPTY_TITLES }: MemberPanelProps) {
  const [session, setSession] = useState<MemberSessionStatus | null>(null);
  const [member, setMember] = useState<MemberState | null>(null);
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [signupUsername, setSignupUsername] = useState('');
  const [profileUsername, setProfileUsername] = useState('');
  const [profileEditing, setProfileEditing] = useState(false);
  const [rentalLimitDraft, setRentalLimitDraft] = useState(3);
  const [rentalLimitStatus, setRentalLimitStatus] = useState('');
  const [signup, setSignup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returningId, setReturningId] = useState('');
  const [reviewItem, setReviewItem] = useState<MemberTitle | null>(null);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [collection, setCollection] = useState<'watchLater' | 'favorites' | null>(null);
  const [continueItems, setContinueItems] = useState<ContinueItem[]>([]);
  const pt = locale === 'pt-BR';

  function acceptMemberState(value: unknown) {
    const next = normalizeMemberState(value);
    setMember(next);
    if (next.profile) {
      setProfileUsername(next.profile.username);
      setRentalLimitDraft(next.profile.rentalLimit);
    }
  }

  async function loadState() {
    const value = await fetchMemberState();
    acceptMemberState(value);
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
          if (active) acceptMemberState(value);
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

  useEffect(() => {
    let active = true;
    if (!session?.signedIn || !member?.profile) {
      setContinueItems([]);
      return () => { active = false; };
    }
    const titlesBySeriesId = new Map(knownTitles.flatMap((title) => {
      const seriesId = title.identity.type === 'series' ? externalId(title.identity, 'imdb') : null;
      return seriesId ? [[seriesId, title] as const] : [];
    }));
    void readAllSeriesProgress()
      .then(async (records) => Promise.all(records
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(async (progress): Promise<ContinueItem | null> => {
          const title = titlesBySeriesId.get(progress.seriesId);
          if (!title) return null;
          const episodes = await readLocalSeriesEpisodes(progress.seriesId);
          if (!episodes) return null;
          const episode = nextEpisode(
            episodes,
            new Set(Object.keys(progress.watched)),
            { season: progress.season, episode: progress.episode },
          );
          return episode ? { title, episode } : null;
        })))
      .then((items) => {
        if (active) setContinueItems(items.filter((item): item is ContinueItem => item !== null).slice(0, 3));
      })
      .catch(() => {
        if (active) setContinueItems([]);
      });
    return () => { active = false; };
  }, [knownTitles, member?.profile, session?.signedIn]);

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
      setProfileEditing(false);
      setNotice(pt ? 'Nome público salvo.' : 'Public username saved.');
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
    setRentalLimitStatus('');
    try {
      await updateMemberRentalLimit(value);
      await loadState();
      setRentalLimitStatus(pt ? 'Limite de aluguéis salvo.' : 'Rental limit saved.');
    } catch (cause) {
      setRentalLimitDraft(member?.profile?.rentalLimit ?? 3);
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
      // The single return hook: the rental is already closed, so the tape side
      // may only clean up. It never reports back into this flow.
      releaseReturnedTape(item.id);
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

  if (collection && member) {
    const headingId = `member-${collection}-full-heading`;
    return <section className="member-section" aria-labelledby={headingId}>
    <button type="button" onClick={() => setCollection(null)}>{pt ? 'Voltar à Carteirinha' : 'Back to membership'}</button>
    <h3 id={headingId}>{collection === 'watchLater' ? (pt ? 'Salvas para depois' : 'Saved for later') : (pt ? 'Favoritas' : 'Favorites')}</h3>
    <TapeList onInspect={onInspect} items={member.collections[collection]} locale={locale} empty={pt ? 'Nenhuma fita nesta lista.' : 'No tapes in this list.'} />
  </section>;
  }

  return (
    <div className="member-overview">
      <section className="membership-card" aria-labelledby="member-card-heading">
        <h3 id="member-card-heading" className="sr-only">{pt ? 'Dados da Carteirinha' : 'Membership details'}</h3>
        <div className="membership-mark" aria-hidden="true">WL</div>
        <div className="membership-username">
          <span>{pt ? 'Nome de usuário' : 'Username'}</span>
          <div>
            <strong>@{username}</strong>
            {member?.profile && <button type="button" className="membership-edit"
              aria-label={pt ? 'Editar nome de usuário' : 'Edit username'}
              aria-controls="member-profile-form" aria-expanded={profileEditing}
              onClick={() => { setProfileUsername(member.profile!.username); setProfileEditing((current) => !current); }}>✎</button>}
          </div>
        </div>
        <div className="membership-since">
          <span>{pt ? 'Membro desde' : 'Member since'}</span>
          <small>{formatDate(member?.profile?.createdAt ?? null, locale)}</small>
        </div>
      </section>
      {error && <p className="member-error" role="alert">{error}</p>}
      {notice && <p className="member-success" role="status">{notice}</p>}
      {!member ? (
        <button type="button" disabled={busy} onClick={() => { setBusy(true); setError(''); void loadState().catch((cause) => setError(messageFrom(cause, pt ? 'Não foi possível carregar sua conta.' : 'Could not load your account.'))).finally(() => setBusy(false)); }}>{pt ? 'Tentar novamente' : 'Try again'}</button>
      ) : !member.profile ? (
        <form id="member-profile-form" className="member-sign-in member-profile-form" onSubmit={saveProfile}>
          <p>{pt ? 'Escolha seu nome público para terminar a Carteirinha.' : 'Choose your public username to finish your membership.'}</p>
          <label htmlFor="member-profile-username">{pt ? 'Nome público' : 'Public username'}</label>
          <input id="member-profile-username" value={profileUsername} onChange={(event) => setProfileUsername(event.target.value)} autoComplete="nickname" minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]{3,24}" required />
          <button type="submit" className="primary-action" disabled={busy}>{busy ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Concluir Carteirinha' : 'Finish membership')}</button>
        </form>
      ) : (
        <>
          {profileEditing && <form id="member-profile-form" className="member-sign-in member-profile-form" onSubmit={saveProfile}>
            <label htmlFor="member-profile-username">{pt ? 'Nome público' : 'Public username'}</label>
            <input id="member-profile-username" value={profileUsername} onChange={(event) => setProfileUsername(event.target.value)} autoComplete="nickname" minLength={3} maxLength={24} pattern="[A-Za-z0-9_-]{3,24}" required />
            <div className="member-inline-actions">
              <button type="submit" className="primary-action" disabled={busy}>{busy ? (pt ? 'Salvando…' : 'Saving…') : (pt ? 'Salvar nome' : 'Save username')}</button>
              <button type="button" disabled={busy} onClick={() => setProfileEditing(false)}>{pt ? 'Cancelar' : 'Cancel'}</button>
            </div>
          </form>}
          <section className="member-section member-rental-limit" aria-labelledby="member-rental-limit-heading">
            <h3 id="member-rental-limit-heading">{pt ? 'Limite de aluguéis' : 'Rental limit'}</h3>
            <div className="member-rental-settings">
              <form onSubmit={(event) => { event.preventDefault(); void saveRentalLimit(rentalLimitDraft); }}>
                <label htmlFor="member-rental-limit">{pt ? 'Limite de aluguéis simultâneos' : 'Simultaneous rental limit'}</label>
                <div>
                  <select id="member-rental-limit" value={rentalLimitDraft} disabled={busy} onChange={(event) => setRentalLimitDraft(Number(event.target.value))}>
                    {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>{i + 1}</option>)}
                  </select>
                  <button type="submit" disabled={busy}>{pt ? 'Salvar limite' : 'Save limit'}</button>
                </div>
                <p className="member-privacy">{pt ? 'Vale para o aplicativo e o site. Reduzir o limite não devolve suas fitas atuais.' : 'Applies to the app and website. Lowering the limit does not return existing rentals.'}</p>
                <p className="member-rental-limit-status" role="status" aria-live="polite">{rentalLimitStatus}</p>
              </form>
              <TapeSpaceCeiling locale={locale} />
            </div>
          </section>
          <section className="member-summary" aria-labelledby="member-stats-heading">
            <h3 id="member-stats-heading" className="sr-only">{pt ? 'Resumo da conta' : 'Account summary'}</h3>
            <dl className="member-counts">
              <div><dd>{member.activeRental?.items.length ?? 0}/{member.profile.rentalLimit}</dd><dt>{pt ? 'Fitas alugadas' : 'Rented tapes'}</dt></div>
              <div><dd>{member.history.length}{member.historyHasMore ? '+' : ''}</dd><dt>{pt ? 'Registros recentes' : 'Recent records'}</dt></div>
              <div><dd>{savedCount}</dd><dt>{pt ? 'Itens salvos' : 'Saved items'}</dt></div>
            </dl>
          </section>
          <section className="member-section member-shelves" aria-labelledby="member-shelves-heading">
            <h3 id="member-shelves-heading">{pt ? 'Prateleiras pessoais' : 'Personal shelves'}</h3>
            <div className="member-shelf-grid">
              <section className="member-shelf" aria-labelledby="member-watch-later-heading">
                <header><h4 id="member-watch-later-heading">{pt ? '＋ Assistir depois' : '＋ Watch later'}</h4>
                  <button type="button" onClick={() => setCollection('watchLater')}>{pt ? 'Abrir lista' : 'Open list'} ({member.collections.watchLater.length})</button></header>
                <TapeList onInspect={onInspect} items={member.collections.watchLater.slice(0, 3)} locale={locale} empty={pt ? 'Nenhuma fita salva.' : 'No saved tapes.'} />
              </section>
              <section className="member-shelf" aria-labelledby="member-favorites-heading">
                <header><h4 id="member-favorites-heading">{pt ? '★ Favoritas' : '★ Favorites'}</h4>
                  <button type="button" onClick={() => setCollection('favorites')}>{pt ? 'Abrir lista' : 'Open list'} ({member.collections.favorites.length})</button></header>
                <TapeList onInspect={onInspect} items={member.collections.favorites.slice(0, 3)} locale={locale} empty={pt ? 'Nenhuma fita favorita.' : 'No favorite tapes.'} />
              </section>
              {continueItems.length > 0 && <section className="member-shelf" aria-labelledby="member-continue-heading">
                <header><h4 id="member-continue-heading">{pt ? '▶ Continuar assistindo' : '▶ Continue watching'}</h4></header>
                <ul className="member-tape-list member-continue-list">
                  {continueItems.map(({ title, episode }) => <li key={externalId(title.identity, 'imdb') ?? title.identity.canonicalKey}>
                    <span><button type="button" className="member-title-link"
                      aria-label={pt ? `Inspecionar ${title.name}` : `Inspect ${title.name}`}
                      onClick={() => onInspect(title)}>{title.name}</button>
                      <small>{episodeLabel(episode)}{episode.name ? ` · ${episode.name}` : ''}</small></span>
                  </li>)}
                </ul>
              </section>}
            </div>
          </section>
          <section className="member-section member-active-rentals" aria-labelledby="member-active-heading">
            <h3 id="member-active-heading">{pt ? 'Fitas alugadas' : 'Active rentals'}</h3>
            {member.activeRental?.items.length ? <ul className="member-tape-list member-return-list">
              {member.activeRental.items.map((item) => <li key={item.id}>
                <span><MemberTitleLink item={item} locale={locale} onInspect={onInspect} /><small>{item.year ?? '—'}</small></span>
                <small className="return-counter-label">{pt ? 'Devolver no Balcão' : 'Return at the Counter'}</small>
                <div className="return-actions" aria-label={pt ? `Devolver ${item.name}` : `Return ${item.name}`}>
                  <button type="button" disabled={returningId === item.id} onClick={() => void returnTape(item, 'watched')}>{pt ? 'Assisti' : 'Watched'}</button>
                  <button type="button" disabled={returningId === item.id} onClick={() => void returnTape(item, 'not_watched')}>{pt ? 'Não assisti' : 'Not watched'}</button>
                  <button type="button" disabled={returningId === item.id} onClick={() => void returnTape(item, 'unknown')}>{pt ? 'Não dizer' : 'Skip'}</button>
                </div>
              </li>)}
            </ul> : <p className="member-empty">{pt ? 'Nenhuma fita alugada agora.' : 'No tapes currently rented.'}</p>}
          </section>
          <TapeDashboard locale={locale} onInspect={onInspect} knownTitles={knownTitles} />
          {reviewItem && (
            <section className="member-section return-review" aria-labelledby="member-return-review-heading">
              <h3 id="member-return-review-heading">{pt ? `Avaliação de ${reviewItem.name}` : `Review ${reviewItem.name}`}</h3>
              <p>{pt ? 'Você marcou esta devolução como assistida. Registre sua avaliação agora.' : 'You marked this return as watched. Share your review now.'}</p>
              <TitleReviews contentType={reviewItem.type} tmdbId={reviewItem.tmdbId} locale={locale} />
            </section>
          )}
          <details className="member-section member-history" aria-labelledby="member-history-heading">
            <summary id="member-history-heading">{pt ? 'Histórico da Locadora' : 'Locadora history'}</summary>
            <TapeList onInspect={onInspect} items={member.history} locale={locale} empty={pt ? 'Seu histórico ainda está vazio.' : 'Your history is still empty.'} />
            {member.historyHasMore && <button type="button" className="history-more" disabled={historyBusy} onClick={() => void loadMoreHistory()}>{historyBusy ? (pt ? 'Buscando…' : 'Loading…') : (pt ? 'Carregar histórico' : 'Load history')}</button>}
          </details>
        </>
      )}
      <button type="button" className="text-action" disabled={busy} onClick={() => void signOut()}>{pt ? 'Sair da Locadora' : 'Sign out of Locadora'}</button>
    </div>
  );
}
