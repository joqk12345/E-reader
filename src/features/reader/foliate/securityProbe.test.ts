import { describe, expect, it } from 'vitest';
import { evaluateActiveContentProbe } from './securityProbe';

const inertSnapshot = {
  fixtureId: 'active-content-epub3',
  manifestScriptExecuted: false,
  inlineScriptExecuted: false,
  onloadHandlerExecuted: false,
  remoteResourceUrls: [],
};

describe('active content WebView probe evaluation', () => {
  it('passes only when active-content markers stay unset and no remote resource is observed', () => {
    expect(evaluateActiveContentProbe(inertSnapshot)).toEqual({
      fixtureId: 'active-content-epub3',
      passed: true,
      checks: [
        { id: 'manifest-script', passed: true, evidence: 'not executed' },
        { id: 'inline-script', passed: true, evidence: 'not executed' },
        { id: 'onload-handler', passed: true, evidence: 'not executed' },
        { id: 'remote-resources', passed: true, evidence: 'none observed' },
      ],
    });
  });

  it('reports every observed violation instead of stopping at the first failure', () => {
    const result = evaluateActiveContentProbe({
      ...inertSnapshot,
      manifestScriptExecuted: true,
      inlineScriptExecuted: true,
      onloadHandlerExecuted: true,
      remoteResourceUrls: [
        'https://example.invalid/reader-epub-image-probe.png',
        'https://example.invalid/reader-epub-frame-probe',
      ],
    });

    expect(result.passed).toBe(false);
    expect(result.checks.filter((check) => !check.passed).map((check) => check.id)).toEqual([
      'manifest-script',
      'inline-script',
      'onload-handler',
      'remote-resources',
    ]);
    expect(result.checks[3].evidence).toContain('reader-epub-image-probe.png');
  });
});
