// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_TITLES } from '../src/locadora/fixture';

const native = vi.hoisted(() => ({
  fetchTitleReviews: vi.fn(),
  readMemberSession: vi.fn(),
  fetchMemberReviewEligibility: vi.fn(),
  writeMemberReview: vi.fn(),
}));

vi.mock('../src/platform/nativeBridge', () => native);

import { TitleReviews } from '../src/components/TitleReviews';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('title reviews', () => {
  it('publishes only through the eligible member review flow and refreshes public reviews', async () => {
    native.fetchTitleReviews
      .mockResolvedValueOnce({ summary: { averageRating: 0, ratingCount: 0 }, reviews: [] })
      .mockResolvedValueOnce({ summary: { averageRating: 4.5, ratingCount: 1 }, reviews: [{ id: 'review-1', username: 'will', rating: 4.5, body: 'Muito bom.' }] });
    native.readMemberSession.mockResolvedValue({ configured: true, signedIn: true, user: { id: 'user-1', username: 'will' } });
    native.fetchMemberReviewEligibility.mockResolvedValue({ eligible: true });
    native.writeMemberReview.mockResolvedValue({ review: { id: 'review-1' } });
    const user = userEvent.setup();
    render(<TitleReviews title={FIXTURE_TITLES[0]} locale="pt-BR" />);

    await user.selectOptions(await screen.findByLabelText('Sua nota'), '4.5');
    await user.type(screen.getByLabelText('Sua resenha'), 'Muito bom.');
    await user.click(screen.getByRole('button', { name: 'Publicar avaliação' }));

    expect(native.writeMemberReview).toHaveBeenCalledWith('movie', 101, 4.5, 'Muito bom.');
    expect(await screen.findByText('@will')).toBeInTheDocument();
    expect(screen.getByText('Avaliação publicada.')).toBeInTheDocument();
  });
});
