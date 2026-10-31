import type { ProtocolError } from '@warfront/shared/protocol';

/** A refusal with an HTTP status and a code the client can act on. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: ProtocolError | string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what = 'That match') => new HttpError(404, 'not-found', `${what} was not found`);
export const forbidden = (message: string) => new HttpError(403, 'forbidden', message);
export const conflict = (code: string, message: string) => new HttpError(409, code, message);
