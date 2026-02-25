const GITHUB_LATEST_RELEASE_API = 'https://api.github.com/repos/joqk12345/E-reader/releases/latest';
const UPDATE_CACHE_KEY = 'reader:update-check-cache';
const AUTO_UPDATE_ENABLED_KEY = 'reader:auto-update-enabled';
const UPDATE_DISMISSED_VERSION_KEY = 'reader:update-dismissed-version';

export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateTarget = {
  os: string;
  arch: string;
};

type GitHubAsset = {
  name?: string;
  browser_download_url?: string;
};

type GitHubRelease = {
  tag_name?: string;
  html_url?: string;
  published_at?: string;
  name?: string | null;
  body?: string | null;
  assets?: GitHubAsset[];
};

export type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  releaseUrl: string;
  downloadUrl: string | null;
  releaseName: string | null;
  publishedAt: string | null;
  notes: string | null;
  checkedAt: number;
  error: string | null;
};

const normalizeVersion = (value: string): string => value.trim().replace(/^v/i, '');

const parseVersion = (value: string): number[] => {
  const normalized = normalizeVersion(value).split('-')[0];
  if (!normalized) return [0, 0, 0];
  return normalized
    .split('.')
    .slice(0, 3)
    .map((part) => {
      const numeric = Number.parseInt(part.replace(/[^\d]/g, ''), 10);
      return Number.isFinite(numeric) ? numeric : 0;
    });
};

const compareVersions = (left: string, right: string): number => {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  const maxLen = Math.max(leftParts.length, rightParts.length, 3);

  for (let index = 0; index < maxLen; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
};

const matchesAny = (name: string, needles: string[]): boolean =>
  needles.some((needle) => name.includes(needle));

const pickAssetForTarget = (assets: GitHubAsset[], target: UpdateTarget): string | null => {
  const candidates = assets
    .map((asset) => ({
      name: (asset.name || '').toLowerCase(),
      url: asset.browser_download_url || '',
    }))
    .filter((item) => item.name && item.url);

  if (candidates.length === 0) return null;

  const preferArm = matchesAny(target.arch.toLowerCase(), ['aarch64', 'arm64', 'arm']);
  const preferX64 = matchesAny(target.arch.toLowerCase(), ['x86_64', 'x64', 'amd64', 'x86']);
  const os = target.os.toLowerCase();

  const score = (name: string): number => {
    let value = 0;
    const hasArm = matchesAny(name, ['aarch64', 'arm64', 'arm']);
    const hasX64 = matchesAny(name, ['x86_64', 'x64', 'amd64', 'intel']);

    if (os.includes('mac')) {
      if (name.endsWith('.dmg')) value += 80;
      if (name.endsWith('.app.tar.gz')) value += 30;
      if (preferArm && hasArm) value += 50;
      if (preferX64 && hasX64) value += 50;
      if (preferArm && hasX64) value -= 20;
      if (preferX64 && hasArm) value -= 20;
    } else if (os.includes('win')) {
      if (name.endsWith('.msi')) value += 80;
      if (name.endsWith('.exe')) value += 70;
      if (preferX64 && hasX64) value += 40;
      if (preferArm && hasArm) value += 40;
    } else {
      if (name.endsWith('.appimage')) value += 80;
      if (name.endsWith('.deb')) value += 70;
      if (name.endsWith('.rpm')) value += 60;
      if (preferX64 && hasX64) value += 25;
      if (preferArm && hasArm) value += 25;
    }
    return value;
  };

  candidates.sort((a, b) => score(b.name) - score(a.name));
  const best = candidates[0];
  if (!best || score(best.name) <= 0) return null;
  return best.url;
};

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Failed to check updates.';
};

export const loadCachedUpdateResult = (): UpdateCheckResult | null => {
  try {
    const raw = localStorage.getItem(UPDATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UpdateCheckResult>;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.checkedAt !== 'number' || !Number.isFinite(parsed.checkedAt)) return null;
    if (typeof parsed.currentVersion !== 'string') return null;
    if (typeof parsed.latestVersion !== 'string') return null;
    if (typeof parsed.releaseUrl !== 'string') return null;
    if (typeof parsed.updateAvailable !== 'boolean') return null;

    return {
      currentVersion: parsed.currentVersion,
      latestVersion: parsed.latestVersion,
      updateAvailable: parsed.updateAvailable,
      releaseUrl: parsed.releaseUrl,
      downloadUrl: parsed.downloadUrl ?? null,
      releaseName: parsed.releaseName ?? null,
      publishedAt: parsed.publishedAt ?? null,
      notes: parsed.notes ?? null,
      checkedAt: parsed.checkedAt,
      error: parsed.error ?? null,
    };
  } catch {
    return null;
  }
};

export const saveUpdateResult = (result: UpdateCheckResult) => {
  localStorage.setItem(UPDATE_CACHE_KEY, JSON.stringify(result));
};

export const isAutoUpdateEnabled = (): boolean => {
  const raw = localStorage.getItem(AUTO_UPDATE_ENABLED_KEY);
  if (raw === null) return true;
  return raw === '1';
};

export const setAutoUpdateEnabled = (enabled: boolean) => {
  localStorage.setItem(AUTO_UPDATE_ENABLED_KEY, enabled ? '1' : '0');
};

export const getDismissedUpdateVersion = (): string | null =>
  localStorage.getItem(UPDATE_DISMISSED_VERSION_KEY);

export const setDismissedUpdateVersion = (version: string) => {
  localStorage.setItem(UPDATE_DISMISSED_VERSION_KEY, version);
};

export const clearDismissedUpdateVersion = () => {
  localStorage.removeItem(UPDATE_DISMISSED_VERSION_KEY);
};

export const checkForUpdates = async (
  currentVersion: string,
  target: UpdateTarget,
  options: { signal?: AbortSignal } = {}
): Promise<UpdateCheckResult> => {
  const response = await fetch(GITHUB_LATEST_RELEASE_API, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
    },
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`GitHub releases API returned ${response.status}.`);
  }

  const release = (await response.json()) as GitHubRelease;
  const latestVersion = normalizeVersion(release.tag_name || '');
  if (!latestVersion) {
    throw new Error('Latest release tag is missing.');
  }

  const normalizedCurrent = normalizeVersion(currentVersion || '0.0.0');
  const updateAvailable = compareVersions(latestVersion, normalizedCurrent) > 0;
  const releaseUrl = release.html_url || 'https://github.com/joqk12345/E-reader/releases';
  const downloadUrl = pickAssetForTarget(release.assets || [], target);

  return {
    currentVersion: normalizedCurrent,
    latestVersion,
    updateAvailable,
    releaseUrl,
    downloadUrl,
    releaseName: release.name ?? null,
    publishedAt: release.published_at ?? null,
    notes: release.body ?? null,
    checkedAt: Date.now(),
    error: null,
  };
};
