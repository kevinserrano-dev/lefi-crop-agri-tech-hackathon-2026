import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** UI preferences only. Nothing from the Brain and nothing secret lives here. */
interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
    }),
    { name: 'lefi-ui-prefs' },
  ),
);
