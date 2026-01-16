import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';
import type { ErrorEvent } from '@dex-monit/observability-contracts';

export interface FingerprintResult {
  fingerprint: string[];
  fingerprintHash: string;
  culprit: string | null;
  metadata: {
    type?: string;
    value?: string;
    filename?: string;
    function?: string;
  };
}

/**
 * Issue Grouping Service
 * 
 * Generates fingerprints for error events to group them into issues.
 * Similar errors should produce the same fingerprint.
 */
@Injectable()
export class IssueGroupingService {
  /**
   * Generate a fingerprint for an error event
   * 
   * The fingerprint is used to group similar errors together.
   * Events with the same fingerprint are considered the same issue.
   */
  generateFingerprint(event: ErrorEvent): FingerprintResult {
    // If custom fingerprint is provided, use it
    if (event.fingerprint && event.fingerprint.length > 0) {
      return {
        fingerprint: event.fingerprint,
        fingerprintHash: this.hashFingerprint(event.fingerprint),
        culprit: this.extractCulprit(event),
        metadata: this.extractMetadata(event),
      };
    }

    // Generate fingerprint from event data
    const fingerprint: string[] = [];

    // 1. Exception type (e.g., "TypeError", "ReferenceError")
    if (event.exception?.type) {
      fingerprint.push(event.exception.type);
    }

    // 2. Normalized message (remove dynamic parts)
    const normalizedMessage = this.normalizeMessage(event.message);
    if (normalizedMessage) {
      fingerprint.push(normalizedMessage);
    }

    // 3. Top frame information (file + function)
    const stacktrace = event.exception?.stacktrace;
    if (stacktrace && stacktrace.length > 0) {
      // Find the first "in-app" frame (not from node_modules)
      const appFrame = stacktrace.find(
        (frame) => !frame.filename.includes('node_modules')
      ) || stacktrace[0];

      if (appFrame) {
        fingerprint.push(appFrame.filename);
        if (appFrame.function && appFrame.function !== '<anonymous>') {
          fingerprint.push(appFrame.function);
        }
      }
    }

    // 4. Platform as fallback
    if (fingerprint.length === 0) {
      fingerprint.push(event.platform);
      fingerprint.push(event.message.substring(0, 100));
    }

    return {
      fingerprint,
      fingerprintHash: this.hashFingerprint(fingerprint),
      culprit: this.extractCulprit(event),
      metadata: this.extractMetadata(event),
    };
  }

  /**
   * Hash a fingerprint array into a single string
   */
  private hashFingerprint(fingerprint: string[]): string {
    const joined = fingerprint.join('|');
    return crypto.createHash('sha256').update(joined).digest('hex');
  }

  /**
   * Normalize error message to remove dynamic parts
   * 
   * Examples:
   * - "Cannot read property 'x' of undefined" → "Cannot read property of undefined"
   * - "User 12345 not found" → "User not found"
   * - "Error at line 42" → "Error at line"
   */
  private normalizeMessage(message: string): string {
    return message
      // Remove quotes content
      .replace(/'[^']*'/g, '')
      .replace(/"[^"]*"/g, '')
      // Remove numbers
      .replace(/\b\d+\b/g, '')
      // Remove UUIDs
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')
      // Remove hex strings
      .replace(/0x[0-9a-f]+/gi, '')
      // Remove file paths
      .replace(/\/[^\s]+/g, '')
      // Remove URLs
      .replace(/https?:\/\/[^\s]+/g, '')
      // Clean up whitespace
      .replace(/\s+/g, ' ')
      .trim()
      // Truncate
      .substring(0, 200);
  }

  /**
   * Extract culprit (file:line where error originated)
   */
  private extractCulprit(event: ErrorEvent): string | null {
    const stacktrace = event.exception?.stacktrace;
    
    if (!stacktrace || stacktrace.length === 0) {
      return null;
    }

    // Find first in-app frame
    const appFrame = stacktrace.find(
      (frame) => !frame.filename.includes('node_modules')
    ) || stacktrace[0];

    if (appFrame) {
      let culprit = appFrame.filename;
      if (appFrame.lineno) {
        culprit += `:${appFrame.lineno}`;
      }
      if (appFrame.function && appFrame.function !== '<anonymous>') {
        culprit = `${appFrame.function} (${culprit})`;
      }
      return culprit;
    }

    return null;
  }

  /**
   * Extract metadata for issue display
   */
  private extractMetadata(event: ErrorEvent): FingerprintResult['metadata'] {
    const stacktrace = event.exception?.stacktrace;
    const topFrame = stacktrace?.[0];

    return {
      type: event.exception?.type,
      value: event.exception?.value?.substring(0, 500),
      filename: topFrame?.filename,
      function: topFrame?.function,
    };
  }

  /**
   * Generate a short ID for an issue (e.g., "DEX-1234")
   */
  generateShortId(counter: number): string {
    return `DEX-${counter}`;
  }
}
