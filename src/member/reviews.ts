export interface PublicReview {
  id: string;
  username: string;
  rating: number;
  body: string;
  createdAt: string | null;
}

export interface PublicReviews {
  summary: { averageRating: number; ratingCount: number };
  reviews: PublicReview[];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rating(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0.5 && value <= 5 && Number.isInteger(value * 2)
    ? value
    : null;
}

export function normalizePublicReviews(value: unknown): PublicReviews {
  const data = record(value) ?? {};
  const summary = record(data.summary) ?? {};
  const reviews = Array.isArray(data.reviews) ? data.reviews.slice(0, 100).flatMap((value) => {
    const review = record(value);
    const id = typeof review?.id === 'string' && review.id.length <= 180 ? review.id : null;
    const username = typeof review?.username === 'string' && review.username.trim() && review.username.length <= 24 ? review.username.trim() : null;
    const score = rating(review?.rating);
    const body = typeof review?.body === 'string' && review.body.trim() && review.body.length <= 1_000 ? review.body.trim() : null;
    if (!id || !username || score === null || !body) return [];
    return [{ id, username, rating: score, body, createdAt: typeof review?.createdAt === 'string' && review.createdAt.length <= 64 ? review.createdAt : null }];
  }) : [];
  const ratingCount = typeof summary.ratingCount === 'number' && Number.isSafeInteger(summary.ratingCount) && summary.ratingCount >= 0
    ? summary.ratingCount
    : reviews.length;
  const averageRating = typeof summary.averageRating === 'number' && Number.isFinite(summary.averageRating) && summary.averageRating >= 0 && summary.averageRating <= 5
    ? summary.averageRating
    : 0;
  return { summary: { averageRating, ratingCount }, reviews };
}

export function normalizeReviewEligibility(value: unknown): boolean {
  return record(value)?.eligible === true;
}
