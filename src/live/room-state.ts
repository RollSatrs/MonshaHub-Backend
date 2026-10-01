/**
 * Состояние помещения вычисляется, а не хранится (кроме уборки — она хранится в room_cleanings).
 * Единственное место, где принимается решение о состоянии; frontend его не пересчитывает.
 */
export const ENDING_SOON_MINUTES = 10;

export const PRIVATE_ROOM_STATES = [
  'AVAILABLE',
  'OCCUPIED',
  'ENDING_SOON',
  'OVERTIME',
  'CLEANING',
] as const;
export const PUBLIC_ROOM_STATES = ['OPEN', 'FULL'] as const;
export const ROOM_STATES = [
  ...PRIVATE_ROOM_STATES,
  ...PUBLIC_ROOM_STATES,
] as const;
export type RoomState = (typeof ROOM_STATES)[number];
export type VisitTimeState = 'OCCUPIED' | 'ENDING_SOON' | 'OVERTIME';

/** Время активного PRIVATE-посещения: просрочено / скоро закончится / идёт. */
export function computeVisitTimeState(endsAt: Date, now: Date): VisitTimeState {
  const remainingMs = endsAt.getTime() - now.getTime();
  if (remainingMs < 0) return 'OVERTIME';
  if (remainingMs <= ENDING_SOON_MINUTES * 60_000) return 'ENDING_SOON';
  return 'OCCUPIED';
}

export function computePrivateRoomState(input: {
  activeVisitEndsAt: Date | null;
  hasOpenCleaning: boolean;
  now: Date;
}): RoomState {
  if (input.activeVisitEndsAt) {
    return computeVisitTimeState(input.activeVisitEndsAt, input.now);
  }
  if (input.hasOpenCleaning) return 'CLEANING';
  return 'AVAILABLE';
}

export function computePublicRoomState(
  inside: number,
  capacity: number,
): RoomState {
  return inside >= capacity ? 'FULL' : 'OPEN';
}
