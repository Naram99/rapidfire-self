import type { GameSettings, GenerationRelease } from '@rapidfire/contracts';
import type { Category, MatchState } from '@rapidfire/game-engine';
import type {
  MatchGeneration,
  QuestionProvider,
} from '../application/ports.js';
import { CommandFailure } from '../application/errors.js';
import { jsonObject, hashJson } from '../lol-data/normalize.js';
import type { CompiledCatalog } from './catalog.js';
import { QuestionPlan } from './generate.js';
import { automaticSeed, seededStreams } from './streams.js';

export type PlayableRelease = Readonly<{
  public: GenerationRelease;
  hash: string;
  catalog: CompiledCatalog;
}>;
export function compareReleases(
  a: Pick<GenerationRelease, 'sourceVersion' | 'revision'>,
  b: Pick<GenerationRelease, 'sourceVersion' | 'revision'>,
): number {
  const left = a.sourceVersion.split('.').map(Number),
    right = b.sourceVersion.split('.').map(Number);
  for (let index = 0; index < 3; index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff) return diff;
  }
  return a.revision - b.revision;
}
export class GeneratedQuestions implements QuestionProvider {
  private readonly available = new Map<string, PlayableRelease>();
  add(release: PlayableRelease): void {
    this.available.set(release.public.id, release);
  }
  releases(): readonly GenerationRelease[] {
    return [...this.available.values()]
      .map((r) => r.public)
      .sort((a, b) => compareReleases(b, a));
  }
  defaultReleaseId(): string | null {
    return this.releases()[0]?.id ?? null;
  }
  private release(id: string | null | undefined): PlayableRelease {
    const selected = id ?? this.defaultReleaseId();
    if (selected === null) throw new CommandFailure('GENERATION_UNAVAILABLE');
    const release = this.available.get(selected);
    if (!release) throw new CommandFailure('RELEASE_UNAVAILABLE');
    return release;
  }
  resolveSettings(settings: GameSettings): GameSettings {
    return {
      ...settings,
      releaseId: this.release(settings.releaseId).public.id,
    };
  }
  categories(
    _topicId: 'league-of-legends',
    releaseId?: string | null,
  ): readonly Category[] {
    if (releaseId === undefined || releaseId === null) {
      const id = this.defaultReleaseId();
      if (id === null) return [];
      releaseId = id;
    }
    return this.release(releaseId).catalog.variants.map((v) => ({
      id: v.id,
      name: v.name,
      language: 'en',
    }));
  }
  createGeneration(settings: GameSettings): MatchGeneration {
    const release = this.release(settings.releaseId),
      seed = settings.seed ?? automaticSeed();
    const streams = seededStreams(seed, release.hash),
      plan = new QuestionPlan(release.catalog, streams);
    const hashes = new Map<string, string>();
    return {
      metadata: {
        releaseId: release.public.id,
        releaseLabel: release.public.label,
        seed,
        seedOrigin: settings.seed === null ? 'automatic' : 'custom',
        eloExclusionReason: settings.seed === null ? null : 'custom_seed',
      },
      prepare: (categoryId) => plan.pack(categoryId),
      categoryChoices: (state: MatchState) => {
        const chosen = state.rounds.flatMap((r) =>
          r.status === 'choosing' ? [] : [r.selection.categoryId],
        );
        const offer = streams(
          'category-offer',
          state.rounds.length + 1,
          chosen,
        );
        return (purpose, items) =>
          purpose === 'category-offer'
            ? offer.index(items.length)
            : streams(
                'automatic-category',
                state.phase.type === 'category_selection'
                  ? state.rounds.length
                  : state.rounds.length + 1,
                items,
              ).index(items.length);
      },
      rounds: (state) =>
        state.rounds.flatMap((round) => {
          if (round.status !== 'prepared') return [];
          const categoryId = round.selection.categoryId;
          let contentHash = hashes.get(categoryId);
          if (!contentHash) {
            contentHash = hashJson(jsonObject({ questions: round.questions }));
            hashes.set(categoryId, contentHash);
          }
          return [{ roundNumber: round.number, categoryId, contentHash }];
        }),
    };
  }
  prepare(): Promise<unknown> {
    return Promise.reject(new Error('GENERATION_CONTEXT_REQUIRED'));
  }
}
