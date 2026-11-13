import { screen } from '@testing-library/react';
import { renderWithProviders, session } from '../../test/render';
import { RequirePermission } from './RequirePermission';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => () => undefined }));

describe('RequirePermission', () => {
  it('renders the screen when the Brain granted the permission', () => {
    renderWithProviders(<RequirePermission permission="nav.audit">audit page</RequirePermission>, {
      session: session(['nav.audit']),
    });
    expect(screen.getByText('audit page')).toBeInTheDocument();
  });

  it('shows Access restricted otherwise', () => {
    renderWithProviders(<RequirePermission permission="nav.audit">audit page</RequirePermission>, {
      session: session(['nav.overview']),
    });
    expect(screen.queryByText('audit page')).not.toBeInTheDocument();
    expect(screen.getByText('Access restricted')).toBeInTheDocument();
  });
});
