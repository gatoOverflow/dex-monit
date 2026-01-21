// Jest test setup
import 'reflect-metadata';

// Mock environment variables
process.env.JWT_SECRET = 'test-jwt-secret-min-32-characters-long';
process.env.JWT_EXPIRES_IN = '1d';
process.env.NODE_ENV = 'test';
process.env.RATE_LIMIT_EVENTS = '10000';
process.env.RATE_LIMIT_LOGS = '100000';
process.env.RATE_LIMIT_TRACES = '100000';

// Global test timeout
jest.setTimeout(10000);

// Clear mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});
