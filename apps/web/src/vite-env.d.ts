/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the game server runs; defaults to http://localhost:3100. */
  readonly VITE_SERVER_URL?: string;
}
