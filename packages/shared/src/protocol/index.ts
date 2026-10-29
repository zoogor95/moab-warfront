// The wire format between clients and the server. A separate entry point
// (`@warfront/shared/protocol`) so the engine itself stays free of runtime dependencies.
import type { z } from 'zod';
import type * as rest from './rest';
import type * as socket from './socket';

export * from './common';
export * from './actions';
export * from './view';
export * from './rest';
export * from './socket';

export type GuestSignInBody = z.output<typeof rest.GuestSignInBodySchema>;
export type CreateMatchBody = z.output<typeof rest.CreateMatchBodySchema>;
export type UpdateSettingsBody = z.output<typeof rest.UpdateSettingsBodySchema>;
export type JoinMatchBody = z.output<typeof rest.JoinMatchBodySchema>;
export type SubmitActionBody = z.output<typeof rest.SubmitActionBodySchema>;

export type MatchSubscribe = z.output<typeof socket.MatchSubscribeSchema>;
export type ActionSubmit = z.output<typeof socket.ActionSubmitSchema>;
export type ChatSend = z.output<typeof socket.ChatSendSchema>;
export type ActionResultMessage = z.output<typeof socket.ActionResultSchema>;
export type MatchEvents = z.output<typeof socket.MatchEventsSchema>;
export type TurnChanged = z.output<typeof socket.TurnChangedSchema>;
export type LobbySeat = z.output<typeof socket.LobbySeatSchema>;
export type LobbyUpdated = z.output<typeof socket.LobbyUpdatedSchema>;
export type PickUpdated = z.output<typeof socket.PickUpdatedSchema>;
export type ChatMessage = z.output<typeof socket.ChatMessageSchema>;
