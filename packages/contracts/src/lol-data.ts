import { z } from 'zod';

export const lolImportRequestSchema = z.strictObject({
  mode: z.enum(['latest', 'reimport']).default('latest'),
});
export const lolImportErrorSchema = z.enum([
  'SOURCE_UNAVAILABLE',
  'SOURCE_DATA_INVALID',
  'SOURCE_TIMEOUT',
  'IMPORT_STORAGE_FAILED',
  'IMPORT_ABORTED',
]);
export type LolImportErrorCode = z.infer<typeof lolImportErrorSchema>;
export const lolCountsSchema = z.strictObject({
  champions: z.number().int().nonnegative(),
  skins: z.number().int().nonnegative(),
  chromas: z.number().int().nonnegative(),
  spells: z.number().int().nonnegative(),
  unverifiedChromaSkins: z.number().int().nonnegative(),
  unverifiedChromaChampions: z.number().int().nonnegative(),
  excludedCooldownSpells: z.number().int().nonnegative(),
});
export type LolCounts = z.infer<typeof lolCountsSchema>;
export const lolDatasetSchema = z.strictObject({
  id: z.uuid(),
  sourceVersion: z.string(),
  normalizationVersion: z.string(),
  contentHash: z.string(),
  locale: z.literal('en_US'),
  completedAt: z.iso.datetime(),
  counts: lolCountsSchema,
});
export type LolDatasetView = z.infer<typeof lolDatasetSchema>;
export const lolImportRunSchema = z.strictObject({
  id: z.uuid(),
  mode: z.enum(['latest', 'reimport']),
  status: z.enum([
    'queued',
    'running',
    'unchanged',
    'succeeded',
    'failed',
    'aborted',
  ]),
  stage: z.enum([
    'queued',
    'resolving',
    'downloading',
    'normalizing',
    'publishing',
    'finished',
  ]),
  sourceVersion: z.string().nullable(),
  datasetId: z.uuid().nullable(),
  processedChampions: z.number().int().nonnegative(),
  totalChampions: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  errorCode: lolImportErrorSchema.nullable(),
});
export type LolImportRunView = z.infer<typeof lolImportRunSchema>;
export const lolAdminDataSchema = z.strictObject({
  activeDataset: lolDatasetSchema.nullable(),
  runs: z.array(lolImportRunSchema),
});
export type LolAdminData = z.infer<typeof lolAdminDataSchema>;
export const adminAccessSchema = z.strictObject({ isAdmin: z.boolean() });
export const LOL_IMPORT_ENGLISH_MESSAGES: Readonly<
  Record<LolImportErrorCode, string>
> = {
  SOURCE_UNAVAILABLE:
    'Champion data could not be downloaded. Try again shortly.',
  SOURCE_DATA_INVALID:
    'The source data failed validation. The previous data is still available.',
  SOURCE_TIMEOUT: 'Downloading champion data timed out. Try again.',
  IMPORT_STORAGE_FAILED:
    'Champion data could not be saved. Check database availability and retry.',
  IMPORT_ABORTED:
    'The import stopped when the server restarted or shut down. Start a new import.',
};
