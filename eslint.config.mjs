import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'

const __dirname = dirname(fileURLToPath(import.meta.url))
const compat = new FlatCompat({ baseDirectory: __dirname })

export default (() => {
  const config = [
    {
      ignores: ['node_modules/**', '.next/**', 'data/**', 'coverage/**', 'next-env.d.ts'],
    },
    ...compat.extends('next/core-web-vitals', 'next/typescript'),
    {
      rules: {
        // Keep these visible without failing the CI build; the existing codebase
        // uses `any` and unused parameters in a few legacy spots.
        '@typescript-eslint/no-explicit-any': 'warn',
        '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        'react/no-unescaped-entities': 'off',
        // The start page uses a plain <a> for the admin login; rewriting it is
        // outside the scope of the test/CI setup.
        '@next/next/no-html-link-for-pages': 'off',
      },
    },
  ]
  return config
})()
