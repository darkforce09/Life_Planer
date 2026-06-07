import React from 'react';
import { render } from '@testing-library/react-native';
import { SystemHealthWidget } from './SystemHealthWidget';

describe('SystemHealthWidget Component', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows ONLINE when the backend reports healthy', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'healthy', sensors: { canvas: 'ok' } }),
    }) as unknown as typeof fetch;

    const { findByText } = render(<SystemHealthWidget />);
    expect(await findByText(/BRAIN: ONLINE/)).toBeTruthy();
  });

  it('falls back to OFFLINE when the backend is unreachable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network down')) as unknown as typeof fetch;

    const { findByText } = render(<SystemHealthWidget />);
    expect(await findByText(/BRAIN: OFFLINE/)).toBeTruthy();
  });
});
