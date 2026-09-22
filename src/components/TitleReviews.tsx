import { type FormEvent, useEffect, useState } from 'react';
import { externalId, type DiscoveryTitle } from '../domain/content';
import { normalizePublicReviews, normalizeReviewEligibility, type PublicReviews } from '../member/reviews';
import { fetchMemberReviewEligibility, fetchTitleReviews, readMemberSession, writeMemberReview } from '../platform/nativeBridge';
import type { Locale } from '../locadora/catalog';

interface TitleReviewsProps {
  title: DiscoveryTitle;
  locale: Locale;
}

function errorMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function TitleReviews({ title, locale }: TitleReviewsProps) {
  const [data, setData] = useState<PublicReviews | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pt = locale === 'pt-BR';
  const tmdbId = Number(externalId(title.identity, 'tmdb'));

  async function load() {
    const reviews = normalizePublicReviews(await fetchTitleReviews(title.identity.type, tmdbId));
    setData(reviews);
    const session = await readMemberSession();
    setSignedIn(session.signedIn);
    if (session.signedIn) {
      setEligible(normalizeReviewEligibility(await fetchMemberReviewEligibility(title.identity.type, tmdbId)));
    }
  }

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const reviews = normalizePublicReviews(await fetchTitleReviews(title.identity.type, tmdbId));
        if (!active) return;
        setData(reviews);
        const session = await readMemberSession();
        if (!active) return;
        setSignedIn(session.signedIn);
        if (session.signedIn) {
          const value = await fetchMemberReviewEligibility(title.identity.type, tmdbId);
          if (active) setEligible(normalizeReviewEligibility(value));
        }
      } catch (cause) {
        if (active) setError(errorMessage(cause, pt ? 'Não foi possível carregar as avaliações.' : 'Could not load reviews.'));
      }
    })();
    return () => { active = false; };
  }, [pt, title.identity.type, tmdbId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await writeMemberReview(title.identity.type, tmdbId, rating, body.trim());
      setBody('');
      setNotice(pt ? 'Avaliação publicada.' : 'Review published.');
      await load();
    } catch (cause) {
      setError(errorMessage(cause, pt ? 'Não foi possível publicar sua avaliação.' : 'Could not publish your review.'));
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <p className="member-error" role="alert">{error}</p>;
  if (!data) return <p className="configuration-status" role="status">{pt ? 'Abrindo o livro de avaliações…' : 'Opening the review book…'}</p>;

  return (
    <section className="title-reviews" aria-label={pt ? 'Avaliações' : 'Reviews'}>
      <div className="review-summary">
        <strong>{data.summary.ratingCount ? `${data.summary.averageRating.toFixed(1).replace(/\.0$/, '')} ★` : (pt ? 'Sem nota ainda' : 'No rating yet')}</strong>
        <span>{data.summary.ratingCount} {pt ? (data.summary.ratingCount === 1 ? 'avaliação pública' : 'avaliações públicas') : (data.summary.ratingCount === 1 ? 'public review' : 'public reviews')}</span>
      </div>
      {eligible ? (
        <form className="review-form" onSubmit={submit}>
          <h3>{pt ? 'Avalie esta fita' : 'Review this tape'}</h3>
          <label htmlFor={`review-rating-${tmdbId}`}>{pt ? 'Sua nota' : 'Your rating'}</label>
          <select id={`review-rating-${tmdbId}`} value={rating} onChange={(event) => setRating(Number(event.target.value))}>
            {Array.from({ length: 10 }, (_, index) => (index + 1) / 2).map((value) => <option key={value} value={value}>{value} ★</option>)}
          </select>
          <label htmlFor={`review-body-${tmdbId}`}>{pt ? 'Sua resenha' : 'Your review'}</label>
          <textarea id={`review-body-${tmdbId}`} value={body} onChange={(event) => setBody(event.target.value)} minLength={1} maxLength={1000} required />
          <button type="submit" disabled={busy}>{busy ? (pt ? 'Publicando…' : 'Publishing…') : (pt ? 'Publicar avaliação' : 'Publish review')}</button>
        </form>
      ) : <p className="review-eligibility">{signedIn
        ? (pt ? 'Marque uma devolução desta fita como assistida para avaliar.' : 'Mark a return as watched to review this tape.')
        : (pt ? 'Entre e devolva esta fita como assistida para avaliar.' : 'Sign in and return this tape as watched to review it.')}</p>}
      {error && <p className="member-error" role="alert">{error}</p>}
      {notice && <p className="member-success" role="status">{notice}</p>}
      <div className="review-list">
        {data.reviews.length ? data.reviews.map((review) => (
          <article key={review.id}>
            <header><strong>@{review.username}</strong><span>{review.rating} ★</span></header>
            <p>{review.body}</p>
          </article>
        )) : <p className="member-empty">{pt ? 'Ainda não há resenhas públicas.' : 'There are no public reviews yet.'}</p>}
      </div>
    </section>
  );
}
