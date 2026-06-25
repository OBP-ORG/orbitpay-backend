/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/', 'decimal-precision\\.test\\.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: './tsconfig.test.json' }],
    // Transform ESM-only packages from @noble/* used transitively by @stellar/stellar-sdk
    '^.+\\.js$': ['ts-jest', { tsconfig: './tsconfig.test.json', allowJs: true }],
  },
  // Allow ts-jest to transform @noble/* and @scure/* (pure-ESM) instead of passing
  // them through to Node unchanged (which would fail because Jest runs in CJS mode).
  transformIgnorePatterns: [
    'node_modules/(?!(@noble|@scure|uint8array-extras)/)',
  ],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/__tests__/**'],
  coverageThreshold: {
    global: { branches: 30, functions: 30, lines: 30, statements: 30 },
  },
};
