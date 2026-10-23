import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', '_site/', '.cache/', 'public/assets/app.js', 'public/sw.js'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', ignoreRestSiblings: true }],
      '@typescript-eslint/consistent-type-imports': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  { files: ['src/app/**'], languageOptions: { globals: globals.browser } },
  { files: ['src/sw.ts', 'worker/**'], languageOptions: { globals: globals.serviceworker } },
  { files: ['scripts/**', 'src/build/**', 'src/model/**', 'tests/**', '*.js'], languageOptions: { globals: globals.node } },
  prettier,
);
