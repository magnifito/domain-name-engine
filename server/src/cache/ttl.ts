const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const TTL = {
  registered: 7 * DAY,
  likelyAvailable: HOUR,
  rdapBootstrap: DAY,
  handles: DAY,
  trademarks: 7 * DAY,
  registrarLive: HOUR,
} as const;
