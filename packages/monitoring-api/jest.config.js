/** @type {import('jest').Config} */
module.exports = {
  displayName: 'monitoring-api',
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.json',
        useESM: true,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  transformIgnorePatterns: [
    'node_modules/(?!(uuid)/)',
  ],
  moduleNameMapper: {
    '^@dex-monit/observability-contracts$': '<rootDir>/../observability/contracts/src/index.ts',
    '^@dex-monit/observability-logger$': '<rootDir>/test/mocks/logger.mock.ts',
    '^@dex-monit/observability-request-context$': '<rootDir>/../observability/request-context/src/index.ts',
    '^@dex-monit/observability-scrubber$': '<rootDir>/../observability/scrubber/src/index.ts',
    '^uuid$': '<rootDir>/test/mocks/uuid.mock.ts',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.d.ts',
    '!src/main.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts'],
  testTimeout: 10000,
};
