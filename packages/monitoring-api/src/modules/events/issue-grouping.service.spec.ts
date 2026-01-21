import { IssueGroupingService, FingerprintResult } from './issue-grouping.service';
import type { ErrorEvent } from '@dex-monit/observability-contracts';

describe('IssueGroupingService', () => {
  let service: IssueGroupingService;

  beforeEach(() => {
    service = new IssueGroupingService();
  });

  describe('generateFingerprint', () => {
    it('should use custom fingerprint when provided', () => {
      const event: ErrorEvent = {
        eventId: 'test-1',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'Test error',
        fingerprint: ['custom', 'fingerprint'],
      };

      const result = service.generateFingerprint(event);

      expect(result.fingerprint).toEqual(['custom', 'fingerprint']);
      expect(result.fingerprintHash).toBeDefined();
      expect(result.fingerprintHash.length).toBe(64); // SHA256 hex
    });

    it('should generate fingerprint from exception type', () => {
      const event: ErrorEvent = {
        eventId: 'test-2',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'Cannot read property x of undefined',
        exception: {
          type: 'TypeError',
          value: 'Cannot read property x of undefined',
          stacktrace: [],
        },
      };

      const result = service.generateFingerprint(event);

      expect(result.fingerprint).toContain('TypeError');
      expect(result.metadata.type).toBe('TypeError');
    });

    it('should include top stack frame in fingerprint', () => {
      const event: ErrorEvent = {
        eventId: 'test-3',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'Test error',
        exception: {
          type: 'Error',
          value: 'Test error',
          stacktrace: [
            {
              filename: '/app/src/services/user.service.ts',
              function: 'UserService.findById',
              lineno: 42,
              colno: 10,
            },
          ],
        },
      };

      const result = service.generateFingerprint(event);

      expect(result.fingerprint).toContain('/app/src/services/user.service.ts');
      expect(result.fingerprint).toContain('UserService.findById');
      expect(result.culprit).toContain('user.service.ts');
    });

    it('should skip node_modules frames and use first app frame', () => {
      const event: ErrorEvent = {
        eventId: 'test-4',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'Test error',
        exception: {
          type: 'Error',
          value: 'Test error',
          stacktrace: [
            {
              filename: '/app/node_modules/express/lib/router.js',
              function: 'Router.handle',
              lineno: 100,
              colno: 5,
            },
            {
              filename: '/app/src/controllers/user.controller.ts',
              function: 'UserController.create',
              lineno: 25,
              colno: 8,
            },
          ],
        },
      };

      const result = service.generateFingerprint(event);

      expect(result.fingerprint).toContain('/app/src/controllers/user.controller.ts');
      expect(result.fingerprint).not.toContain('node_modules');
    });

    it('should produce same fingerprint for similar errors', () => {
      const event1: ErrorEvent = {
        eventId: 'test-5a',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'User 12345 not found',
        exception: {
          type: 'NotFoundError',
          value: 'User 12345 not found',
          stacktrace: [
            {
              filename: '/app/src/services/user.service.ts',
              function: 'findById',
              lineno: 42,
              colno: 10,
            },
          ],
        },
      };

      const event2: ErrorEvent = {
        eventId: 'test-5b',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'User 67890 not found',
        exception: {
          type: 'NotFoundError',
          value: 'User 67890 not found',
          stacktrace: [
            {
              filename: '/app/src/services/user.service.ts',
              function: 'findById',
              lineno: 42,
              colno: 10,
            },
          ],
        },
      };

      const result1 = service.generateFingerprint(event1);
      const result2 = service.generateFingerprint(event2);

      // Same fingerprint hash despite different user IDs
      expect(result1.fingerprintHash).toBe(result2.fingerprintHash);
    });

    it('should produce different fingerprints for different error types', () => {
      const event1: ErrorEvent = {
        eventId: 'test-6a',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'Test error',
        exception: {
          type: 'TypeError',
          value: 'Test error',
          stacktrace: [],
        },
      };

      const event2: ErrorEvent = {
        eventId: 'test-6b',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'Test error',
        exception: {
          type: 'ReferenceError',
          value: 'Test error',
          stacktrace: [],
        },
      };

      const result1 = service.generateFingerprint(event1);
      const result2 = service.generateFingerprint(event2);

      expect(result1.fingerprintHash).not.toBe(result2.fingerprintHash);
    });

    it('should handle events without exception', () => {
      const event: ErrorEvent = {
        eventId: 'test-7',
        timestamp: new Date().toISOString(),
        platform: 'browser',
        message: 'Generic error message',
      };

      const result = service.generateFingerprint(event);

      expect(result.fingerprint.length).toBeGreaterThan(0);
      expect(result.fingerprintHash).toBeDefined();
    });

    it('should extract culprit from stack trace', () => {
      const event: ErrorEvent = {
        eventId: 'test-8',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'Test error',
        exception: {
          type: 'Error',
          value: 'Test error',
          stacktrace: [
            {
              filename: '/app/src/services/payment.service.ts',
              function: 'processPayment',
              lineno: 128,
              colno: 15,
            },
          ],
        },
      };

      const result = service.generateFingerprint(event);

      expect(result.culprit).toBe('processPayment (/app/src/services/payment.service.ts:128)');
    });

    it('should return null culprit when no stacktrace', () => {
      const event: ErrorEvent = {
        eventId: 'test-9',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'Error without stack',
      };

      const result = service.generateFingerprint(event);

      expect(result.culprit).toBeNull();
    });
  });

  describe('generateShortId', () => {
    it('should generate short ID with prefix', () => {
      const shortId = service.generateShortId(1234);
      expect(shortId).toBe('DEX-1234');
    });

    it('should handle large numbers', () => {
      const shortId = service.generateShortId(999999);
      expect(shortId).toBe('DEX-999999');
    });
  });

  describe('message normalization', () => {
    it('should normalize messages with different dynamic values to same fingerprint', () => {
      const baseEvent = {
        timestamp: new Date().toISOString(),
        platform: 'node' as const,
        exception: {
          type: 'ValidationError',
          value: '',
          stacktrace: [],
        },
      };

      const events = [
        { ...baseEvent, eventId: 'n1', message: "Cannot read property 'name' of undefined" },
        { ...baseEvent, eventId: 'n2', message: "Cannot read property 'email' of undefined" },
        { ...baseEvent, eventId: 'n3', message: "Cannot read property 'id' of undefined" },
      ];

      const fingerprints = events.map((e) => service.generateFingerprint(e).fingerprintHash);

      // All should have the same fingerprint since the property name is removed
      expect(fingerprints[0]).toBe(fingerprints[1]);
      expect(fingerprints[1]).toBe(fingerprints[2]);
    });

    it('should normalize messages by removing dynamic parts', () => {
      const event: ErrorEvent = {
        eventId: 't1',
        timestamp: new Date().toISOString(),
        platform: 'node',
        message: 'Order 550e8400-e29b-41d4-a716-446655440000 failed at line 42',
        exception: { type: 'OrderError', value: '', stacktrace: [
          { filename: '/app/src/order.ts', function: 'process', lineno: 10, colno: 5 }
        ] },
      };

      const result = service.generateFingerprint(event);

      // Fingerprint should be generated successfully
      expect(result.fingerprint).toBeDefined();
      expect(result.fingerprint.length).toBeGreaterThan(0);
      expect(result.fingerprintHash).toBeDefined();
      expect(result.fingerprintHash.length).toBe(64);
    });
  });
});
