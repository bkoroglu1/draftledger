import next from 'eslint-config-next';

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'data/**',
      'test-results/**',
      'playwright-report/**',
      'src/db/migrations/**',
    ],
  },
  ...next,
  {
    rules: {
      // The reader and preview render HTML produced by our own escaping
      // HTMLizer; every other sink goes through the sanitizer.
      'react/no-danger': 'off',
    },
  },
];

export default config;
