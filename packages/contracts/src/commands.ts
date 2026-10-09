import { z } from 'zod';

export const PROTOCOL_VERSION = 2;
export const handshakeSchema = z.strictObject({
  protocolVersion: z.literal(PROTOCOL_VERSION),
});
export type Handshake = z.infer<typeof handshakeSchema>;
const id = z.string().min(1).max(128);
const request = { requestId: id };
export const gameTopicSchema = z.enum(['league-of-legends']);
export type GameTopic = z.infer<typeof gameTopicSchema>;
export const settingsSchema = z.strictObject({
  topicId: gameTopicSchema,
  rounds: z.number().int().min(1).max(10),
  answerTimeMs: z.number().int().min(5_000).max(60_000).multipleOf(1_000),
});
export type GameSettings = z.infer<typeof settingsSchema>;
const scopeSchema = z.strictObject({ type: z.enum(['room', 'match']), id });
export type Scope = z.infer<typeof scopeSchema>;

export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('room:create'),
    payload: z.strictObject({ ...request, settings: settingsSchema }),
  }),
  z.strictObject({
    type: z.literal('room:join'),
    payload: z.strictObject({
      ...request,
      roomCode: z.string().regex(/^[A-Z2-9]{6}$/),
    }),
  }),
  z.strictObject({
    type: z.literal('room:leave'),
    payload: z.strictObject({ ...request, roomId: id }),
  }),
  z.strictObject({
    type: z.literal('room:settings:update'),
    payload: z.strictObject({
      ...request,
      roomId: id,
      expectedSettingsVersion: z.number().int().positive(),
      settings: settingsSchema,
    }),
  }),
  z.strictObject({
    type: z.literal('room:ready'),
    payload: z.strictObject({
      ...request,
      roomId: id,
      lobbyCycleId: id,
      ready: z.boolean(),
    }),
  }),
  z.strictObject({
    type: z.literal('solo:start'),
    payload: z.strictObject({ ...request, settings: settingsSchema }),
  }),
  z.strictObject({
    type: z.literal('match:leave'),
    payload: z.strictObject({ ...request, matchId: id }),
  }),
  z.strictObject({
    type: z.literal('category:select'),
    payload: z.strictObject({
      ...request,
      matchId: id,
      roundId: id,
      phaseId: id,
      categoryId: id,
    }),
  }),
  z.strictObject({
    type: z.literal('answer:submit'),
    payload: z.strictObject({
      ...request,
      matchId: id,
      questionId: id,
      selectedOptionIds: z
        .array(id)
        .min(1)
        .max(6)
        .refine((ids) => new Set(ids).size === ids.length),
    }),
  }),
  z.strictObject({
    type: z.literal('state:sync'),
    payload: z.strictObject({ ...request, scope: scopeSchema }),
  }),
  z.strictObject({
    type: z.literal('time:sync'),
    payload: z.strictObject(request),
  }),
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandName = Command['type'];
export const COMMAND_NAMES: readonly CommandName[] = [
  'room:create',
  'room:join',
  'room:leave',
  'room:settings:update',
  'room:ready',
  'solo:start',
  'match:leave',
  'category:select',
  'answer:submit',
  'state:sync',
  'time:sync',
];
export function parseCommand(type: string, payload: unknown) {
  return commandSchema.safeParse({ type, payload });
}
export type CommandPayload<Name extends CommandName> = Extract<
  Command,
  { type: Name }
>['payload'];
