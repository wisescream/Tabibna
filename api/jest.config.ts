import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  verbose: true,
  rootDir: '.',
  setupFilesAfterEnv: [],
  moduleFileExtensions: ['ts', 'js', 'json'],
};

export default config;
