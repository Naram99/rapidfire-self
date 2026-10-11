import { z } from 'zod';
export const generationSeedSchema = z.string().regex(/^[A-Za-z0-9]{1,10}$/);
export const generationReleaseSchema = z.object({
  id: z.uuid(),
  topicId: z.literal('league-of-legends'),
  sourceVersion: z.string(),
  revision: z.number().int().positive(),
  label: z.string(),
  categoryCount: z.number().int().positive(),
  maxRounds: z.number().int().min(1).max(10),
});
export type GenerationRelease = z.infer<typeof generationReleaseSchema>;
export const generationMetadataSchema = z.object({
  releaseId: z.uuid(),
  releaseLabel: z.string(),
  seed: generationSeedSchema.nullable(),
  seedOrigin: z.enum(['automatic', 'custom']),
  eloExclusionReason: z.literal('custom_seed').nullable(),
});
export type GenerationMetadata = z.infer<typeof generationMetadataSchema>;
export const generationRoundSchema = z.object({
  roundNumber: z.number().int().min(1).max(10),
  categoryId: z.string(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
});
export type GenerationRound = z.infer<typeof generationRoundSchema>;
