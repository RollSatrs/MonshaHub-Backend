import {
  computePrivateRoomState,
  computePublicRoomState,
  computeVisitTimeState,
  ENDING_SOON_MINUTES,
} from './room-state';

const now = new Date('2026-01-01T12:00:00.000Z');
const plus = (minutes: number, seconds = 0) =>
  new Date(now.getTime() + minutes * 60_000 + seconds * 1000);

describe('room state', () => {
  it('порог ENDING_SOON — 10 минут', () => {
    expect(ENDING_SOON_MINUTES).toBe(10);
  });

  describe('computeVisitTimeState', () => {
    it('OCCUPIED, пока до конца больше порога', () => {
      expect(computeVisitTimeState(plus(10, 1), now)).toBe('OCCUPIED');
      expect(computeVisitTimeState(plus(90), now)).toBe('OCCUPIED');
    });

    it('ENDING_SOON ровно на пороге и до конца времени включительно', () => {
      expect(computeVisitTimeState(plus(10), now)).toBe('ENDING_SOON');
      expect(computeVisitTimeState(plus(1), now)).toBe('ENDING_SOON');
      expect(computeVisitTimeState(plus(0), now)).toBe('ENDING_SOON');
    });

    it('OVERTIME сразу после истечения', () => {
      expect(computeVisitTimeState(plus(0, -1), now)).toBe('OVERTIME');
      expect(computeVisitTimeState(plus(-30), now)).toBe('OVERTIME');
    });
  });

  describe('computePrivateRoomState', () => {
    it('активное посещение важнее уборки', () => {
      expect(
        computePrivateRoomState({
          activeVisitEndsAt: plus(60),
          hasOpenCleaning: true,
          now,
        }),
      ).toBe('OCCUPIED');
    });

    it('без посещения: уборка → CLEANING, иначе AVAILABLE', () => {
      expect(
        computePrivateRoomState({
          activeVisitEndsAt: null,
          hasOpenCleaning: true,
          now,
        }),
      ).toBe('CLEANING');
      expect(
        computePrivateRoomState({
          activeVisitEndsAt: null,
          hasOpenCleaning: false,
          now,
        }),
      ).toBe('AVAILABLE');
    });
  });

  it('PUBLIC: FULL при заполнении, иначе OPEN', () => {
    expect(computePublicRoomState(37, 60)).toBe('OPEN');
    expect(computePublicRoomState(59, 60)).toBe('OPEN');
    expect(computePublicRoomState(60, 60)).toBe('FULL');
    expect(computePublicRoomState(61, 60)).toBe('FULL');
  });
});
