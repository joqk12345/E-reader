export const ACTIVE_CONTENT_PROBE_META = 'reader-security-probe';
export const ACTIVE_CONTENT_PROBE_REMOTE_ORIGIN_META = 'reader-security-probe-remote-origin';

export type ActiveContentProbeSnapshot = {
  fixtureId: string;
  manifestScriptExecuted: boolean;
  inlineScriptExecuted: boolean;
  onloadHandlerExecuted: boolean;
  remoteResourceUrls: string[];
};

export type ActiveContentProbeResult = {
  fixtureId: string;
  passed: boolean;
  checks: Array<{ id: string; passed: boolean; evidence: string }>;
};

const executionCheck = (id: string, executed: boolean) => ({
  id,
  passed: !executed,
  evidence: executed ? 'executed' : 'not executed',
});

export const evaluateActiveContentProbe = (
  snapshot: ActiveContentProbeSnapshot
): ActiveContentProbeResult => {
  const checks = [
    executionCheck('manifest-script', snapshot.manifestScriptExecuted),
    executionCheck('inline-script', snapshot.inlineScriptExecuted),
    executionCheck('onload-handler', snapshot.onloadHandlerExecuted),
    {
      id: 'remote-resources',
      passed: snapshot.remoteResourceUrls.length === 0,
      evidence: snapshot.remoteResourceUrls.length === 0
        ? 'none observed'
        : snapshot.remoteResourceUrls.join(', '),
    },
  ];
  return {
    fixtureId: snapshot.fixtureId,
    passed: checks.every((check) => check.passed),
    checks,
  };
};

const metaContent = (document: Document, name: string): string =>
  document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)?.content.trim() ?? '';

export const snapshotActiveContentProbe = (
  document: Document
): ActiveContentProbeSnapshot | null => {
  const fixtureId = metaContent(document, ACTIVE_CONTENT_PROBE_META);
  if (!fixtureId) return null;

  const remoteOrigin = metaContent(document, ACTIVE_CONTENT_PROBE_REMOTE_ORIGIN_META);
  const remoteResourceUrls = remoteOrigin
    ? (document.defaultView?.performance.getEntriesByType('resource') ?? [])
        .map((entry) => entry.name)
        .filter((name) => name.startsWith(remoteOrigin))
    : [];
  return {
    fixtureId,
    manifestScriptExecuted:
      document.documentElement.dataset.readerManifestScriptExecuted === 'true',
    inlineScriptExecuted:
      document.documentElement.dataset.readerInlineScriptExecuted === 'true',
    onloadHandlerExecuted: document.body?.dataset.readerOnloadExecuted === 'true',
    remoteResourceUrls,
  };
};
