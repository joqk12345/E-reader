import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import {
  parsePublicationLocatorV1,
  type PublicationLocatorV1,
} from './publicationLocator';

export type PublicationPositionInvoke = (
  command: string,
  args?: Record<string, unknown>
) => Promise<unknown>;

export type PublicationPositionV2 = {
  schemaVersion: 1;
  publicationId: string;
  documentId: string;
  sourceHash: string;
  locator: PublicationLocatorV1;
  progression: number | null;
  updatedAt: number;
};

export type PublicationSavePositionV2 = PublicationPositionV2 & { accepted: boolean };

const invokeTauri: PublicationPositionInvoke = (command, args) => tauriInvoke(command, args);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const assertKeys = (
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string
): void => {
  const unknown = Object.keys(value).find((key) => !keys.includes(key));
  if (unknown) throw new Error(`Unknown ${label} field: ${unknown}`);
};

const assertIdentity = (value: Record<string, unknown>, documentId: string): void => {
  if (value.schemaVersion !== 1) throw new Error('Unsupported publication position schema version');
  if (value.documentId !== documentId) throw new Error('Publication position document identity mismatch');
  if (typeof value.publicationId !== 'string' || !value.publicationId) {
    throw new Error('Publication position identity is invalid');
  }
  if (typeof value.sourceHash !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sourceHash)) {
    throw new Error('Publication position source hash is invalid');
  }
  if (value.progression !== null &&
      (typeof value.progression !== 'number' || !Number.isFinite(value.progression) || value.progression < 0 || value.progression > 1)) {
    throw new Error('Publication position progression is invalid');
  }
  if (typeof value.updatedAt !== 'number' || !Number.isSafeInteger(value.updatedAt) || value.updatedAt <= 0) {
    throw new Error('Publication position updatedAt is invalid');
  }
}

const parsePosition = (
  value: unknown,
  documentId: string,
  accepted?: boolean
): PublicationPositionV2 | PublicationSavePositionV2 => {
  if (!isRecord(value)) throw new Error('Publication position response must be an object');
  const keys = ['schemaVersion', 'publicationId', 'documentId', 'sourceHash', 'locator', 'progression', 'updatedAt'];
  if (accepted !== undefined) keys.push('accepted');
  assertKeys(value, keys, 'publication position response');
  assertIdentity(value, documentId);
  if (accepted !== undefined && typeof value.accepted !== 'boolean') {
    throw new Error('Publication position accepted flag is invalid');
  }
  if (!isRecord(value.locator) || typeof value.locator.href !== 'string') {
    throw new Error('Publication position locator is invalid');
  }
  const publicationId = value.publicationId as string;
  const sourceHash = value.sourceHash as string;
  const locator = parsePublicationLocatorV1(value.locator, {
    publicationId,
    sourceHash,
    href: value.locator.href,
  });
  return {
    schemaVersion: 1,
    publicationId,
    documentId,
    sourceHash,
    locator,
    progression: value.progression as number | null,
    updatedAt: value.updatedAt,
    ...(accepted === undefined ? {} : { accepted: value.accepted as boolean }),
  } as PublicationPositionV2 | PublicationSavePositionV2;
};

export const getPublicationPositionV2 = async (
  documentId: string,
  invoke: PublicationPositionInvoke = invokeTauri
): Promise<PublicationPositionV2 | null> => {
  if (!documentId) throw new Error('Publication position documentId is required');
  const value = await invoke('publication_get_position_v2', { request: { documentId } });
  return value === null ? null : parsePosition(value, documentId) as PublicationPositionV2;
};

export const savePublicationPositionV2 = async (
  documentId: string,
  locator: PublicationLocatorV1,
  options: { progression?: number | null; updatedAt: number },
  invoke: PublicationPositionInvoke = invokeTauri
): Promise<PublicationSavePositionV2> => {
  if (!documentId) throw new Error('Publication position documentId is required');
  if (!Number.isSafeInteger(options.updatedAt) || options.updatedAt <= 0) {
    throw new Error('Publication position updatedAt is invalid');
  }
  if (
    options.progression !== undefined &&
    options.progression !== null &&
    (!Number.isFinite(options.progression) || options.progression < 0 || options.progression > 1)
  ) {
    throw new Error('Publication position progression is invalid');
  }
  const checkedLocator = parsePublicationLocatorV1(locator);
  const value = await invoke('publication_save_position_v2', {
    request: {
      documentId,
      locator: checkedLocator,
      progression: options.progression ?? null,
      updatedAt: options.updatedAt,
    },
  });
  return parsePosition(value, documentId, true) as PublicationSavePositionV2;
};
