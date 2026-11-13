import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * The hard rule of ADR-022: shared UI never touches the host directly.
 * packages/app (and api/ui) may not import Tauri or a concrete platform implementation;
 * only apps/desktop/src/main.tsx (the composition root) chooses one.
 */
const hostImports = {
  patterns: [
    {
      group: ['@tauri-apps/*'],
      message: 'Use platform.* — only packages/platform may import Tauri (ADR-022).',
    },
    {
      group: ['@lefi/platform/tauri', '@lefi/platform/web'],
      message: 'Concrete platforms are chosen in apps/desktop/src/main.tsx only.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.venv/**',
      '**/src-tauri/**',
      'docs/**',
      'scripts/**',
      'apps/lefi-mobile/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['packages/app/**', 'packages/api/**', 'packages/ui/**'],
    rules: { 'no-restricted-imports': ['error', hostImports] },
  },
  {
    files: ['packages/mock-brain/**', '**/vite.config.ts', 'vitest.config.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
);
