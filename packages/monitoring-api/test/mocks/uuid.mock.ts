// Mock uuid for testing
let counter = 0;

export const v4 = jest.fn(() => {
  counter++;
  return `mock-uuid-${counter}-${Date.now()}`;
});

export const v1 = jest.fn(() => `mock-uuid-v1-${Date.now()}`);

export default { v4, v1 };
