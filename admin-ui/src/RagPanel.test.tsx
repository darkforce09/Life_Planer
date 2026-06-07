import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RagPanel } from './RagPanel';

vi.mock('./api', () => ({
  apiPost: vi.fn(),
}));

import { apiPost } from './api';

describe('RagPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the search input and action buttons', () => {
    render(<RagPanel />);
    expect(screen.getByPlaceholderText(/Ask a question/i)).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Ask AI')).toBeInTheDocument();
  });

  it('renders an AI answer with sources after asking', async () => {
    (apiPost as ReturnType<typeof vi.fn>).mockResolvedValue({
      answer: 'Sepsis is a life-threatening response to infection [1].',
      sources: [
        { content: 'Sepsis is...', filePath: '/kb/[MV038G] Sepsis.md', courseFolder: 'MV038G', score: 0.91 },
      ],
    });

    render(<RagPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Ask a question/i), {
      target: { value: 'What is sepsis?' },
    });
    fireEvent.click(screen.getByText('Ask AI'));

    await waitFor(() => {
      expect(screen.getByText(/life-threatening response/i)).toBeInTheDocument();
    });
    expect(apiPost).toHaveBeenCalledWith('/api/rag/answer', { query: 'What is sepsis?', topK: 8 });
    expect(screen.getByText(/Sepsis.md/)).toBeInTheDocument();
  });

  it('shows an error message when the query fails', async () => {
    (apiPost as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('boom'));

    render(<RagPanel />);
    fireEvent.change(screen.getByPlaceholderText(/Ask a question/i), {
      target: { value: 'anything' },
    });
    fireEvent.click(screen.getByText('Search'));

    await waitFor(() => {
      expect(screen.getByText(/Query failed/i)).toBeInTheDocument();
    });
  });
});
