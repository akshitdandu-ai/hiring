/** Shown at the top of every screen. Override with VITE_TEAM_NAME at build time. */
export const TEAM_NAME: string =
  (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_TEAM_NAME || 'The Last Milers';
export const PAIR_LABEL = '';
export const APP_NAME = 'Pre-Flight';
