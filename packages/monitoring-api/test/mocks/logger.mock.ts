// Mock Logger for testing
export class Logger {
  info = jest.fn();
  warn = jest.fn();
  error = jest.fn();
  debug = jest.fn();
  trace = jest.fn();
  fatal = jest.fn();
  child = jest.fn(() => new Logger());
}

export const createLogger = jest.fn(() => new Logger());
export default Logger;
