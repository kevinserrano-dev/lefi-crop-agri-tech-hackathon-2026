import { fireEvent, screen, waitFor } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import type { AiConversation, AssistantStatus } from '@lefi/api';
import type { Platform } from '@lefi/platform';
import { fakePlatform, renderWithProviders, session } from '../../test/render';
import { LefiAssistant, moodOf } from './LefiAssistant';

const real = { status: 'ok', service: 'lefi-brain', version: '0.5.1', time: 'x' };
const ready: AssistantStatus = {
  state: 'available',
  reason: 'test-model on the AI node',
  model: 'test-model:1b',
  kill_switch: false,
  busy: 0,
  tools: [{ name: 'current_readings', label: 'Current sensor readings' }],
  can_write: false,
};

function withRouter() {
  const root = createRootRoute({ component: LefiAssistant });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={router} />;
}

function platformWith(status: AssistantStatus, conv: AiConversation): Platform {
  const base = fakePlatform({ '/health': real, '/ai/assistant': status });
  const seen: unknown[] = [];
  return {
    ...base,
    api: async <T,>(req: { method?: string; path: string; body?: unknown }): Promise<T> => {
      if (req.method === 'POST' && req.path === '/ai/chat') {
        seen.push(req.body);
        return conv as T;
      }
      if (req.path === `/ai/conversations/${conv.id}`) return conv as T;
      return base.api<T>(req as never);
    },
  };
}

const answered: AiConversation = {
  id: 'c1',
  title: 'temp',
  created_at: 'x',
  updated_at: 'x',
  messages: [
    {
      id: 'm1',
      role: 'user',
      content: '¿Qué temperatura hace en la zona A?',
      state: 'done',
      created_at: 'x',
      completed_at: 'x',
      model: null,
      error: null,
      tools: [],
    },
    {
      id: 'm2',
      role: 'assistant',
      content: 'No hay lecturas recientes del sensor de aire.',
      state: 'done',
      created_at: 'x',
      completed_at: 'x',
      model: 'test-model:1b',
      error: null,
      tools: [
        {
          name: 'current_readings',
          label: 'Current sensor readings',
          outcome: 'ok',
          arguments: {},
        },
        { name: 'field_devices', label: 'Field devices', outcome: 'denied', arguments: {} },
      ],
    },
  ],
};

describe('Lefi AI assistant', () => {
  it('asks Lefi Brain and shows the answer with its model and what it read', async () => {
    renderWithProviders(withRouter(), {
      platform: platformWith(ready, answered),
      session: session(['ai.chat', 'nav.environment']),
    });
    fireEvent.click(await screen.findByTitle('Ask Lefi'));
    expect(await screen.findByText('Ready · test-model:1b')).toBeInTheDocument();
    const box = screen.getByLabelText('Ask Lefi');
    fireEvent.change(box, { target: { value: '¿Qué temperatura hace en la zona A?' } });
    fireEvent.click(screen.getByLabelText('Send'));
    expect(
      await screen.findByText('No hay lecturas recientes del sensor de aire.'),
    ).toBeInTheDocument();
    const source = screen.getByText(/AI answer · test-model:1b/);
    expect(source).toHaveTextContent('read: Current sensor readings');
    expect(source).toHaveTextContent('not allowed for your role: Field devices');
  });

  it('says why when the AI is off, and offers no input', async () => {
    const off: AssistantStatus = {
      ...ready,
      state: 'disabled',
      kill_switch: true,
      reason: 'kill switch is ON (lefi ai off)',
    };
    renderWithProviders(withRouter(), {
      platform: platformWith(off, answered),
      session: session(['ai.chat']),
    });
    fireEvent.click(await screen.findByTitle('Ask Lefi'));
    expect(await screen.findByText('AI stopped (kill switch)')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByText(/AI reasoning unavailable: kill switch is ON/)).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText('Ask Lefi')).not.toBeInTheDocument();
  });

  it('describes every state in words', () => {
    expect(moodOf(undefined, true, false)).toMatch(/no AI assistant yet/);
    expect(moodOf(undefined, false, true)).toBe('AI unavailable for your role');
    expect(moodOf({ ...ready, state: 'unreachable' }, true, true)).toBe('AI node not reachable');
    expect(moodOf({ ...ready, state: 'model_missing' }, true, true)).toBe('AI model not installed');
    expect(moodOf({ ...ready, state: 'unconfigured' }, true, true)).toBe('AI not configured');
  });
});
