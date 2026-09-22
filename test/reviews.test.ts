import { describe, expect, it } from 'vitest';
import { normalizePublicReviews, normalizeReviewEligibility } from '../src/member/reviews';

describe('public review normalization', () => {
  it('keeps bounded public review fields and summary', () => {
    const reviews = normalizePublicReviews({
      summary: { averageRating: 4.5, ratingCount: 2 },
      reviews: [{ id: 'review-1', username: 'will', rating: 4.5, body: 'Muito bom.', createdAt: '2026-09-22T00:00:00Z', email: 'private@example.invalid' }],
    });
    expect(reviews.summary).toEqual({ averageRating: 4.5, ratingCount: 2 });
    expect(reviews.reviews[0]).toEqual({ id: 'review-1', username: 'will', rating: 4.5, body: 'Muito bom.', createdAt: '2026-09-22T00:00:00Z' });
    expect(JSON.stringify(reviews)).not.toContain('private@example.invalid');
  });

  it('drops malformed reviews and accepts only an explicit eligibility boolean', () => {
    expect(normalizePublicReviews({ reviews: [{ id: 'x', username: 'will', rating: 4.2, body: 'Bad rating' }] }).reviews).toEqual([]);
    expect(normalizeReviewEligibility({ eligible: true })).toBe(true);
    expect(normalizeReviewEligibility({ eligible: 'true' })).toBe(false);
  });
});
