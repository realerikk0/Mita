import { describe, test, expect } from 'vitest'
import { ConversationalExtension } from './index';
import { InferenceExtension } from './index';
import { AssistantExtension } from './index';

describe('index.ts exports', () => {
  test('should export ConversationalExtension', () => {
    expect(ConversationalExtension).toBeDefined();
  });

  test('should export InferenceExtension', () => {
    expect(InferenceExtension).toBeDefined();
  });

  test('should export AssistantExtension', () => {
    expect(AssistantExtension).toBeDefined();
  });
});
