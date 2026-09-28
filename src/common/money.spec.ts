import {
  addMoney,
  isMoneyString,
  minorToMoney,
  moneyToMinor,
  multiplyMoney,
  normalizeMoney,
} from './money';

describe('money', () => {
  it('принимает только decimal-строки с не более чем 2 знаками', () => {
    for (const ok of ['0', '1', '10000', '10000.5', '10000.50', '0.01']) {
      expect(isMoneyString(ok)).toBe(true);
    }
    for (const bad of [
      '',
      '-1',
      '1.234',
      '1,5',
      'abc',
      '1e3',
      ' 1',
      '12345678901',
      '.5',
      '1.',
    ]) {
      expect(isMoneyString(bad)).toBe(false);
    }
    expect(isMoneyString(100)).toBe(false);
    expect(isMoneyString(null)).toBe(false);
  });

  it('конвертирует туда и обратно без потерь', () => {
    expect(moneyToMinor('10000.5')).toBe(1000050n);
    expect(moneyToMinor('0.01')).toBe(1n);
    expect(minorToMoney(1000050n)).toBe('10000.50');
    expect(minorToMoney(0n)).toBe('0.00');
    expect(normalizeMoney('2500')).toBe('2500.00');
  });

  it('не страдает от float-ошибок', () => {
    // 0.1 + 0.2 в float = 0.30000000000000004
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(multiplyMoney('19.99', 3)).toBe('59.97');
    expect(multiplyMoney('2500', 2)).toBe('5000.00');
  });

  it('отклоняет некорректные значения', () => {
    expect(() => moneyToMinor('1.234')).toThrow();
    expect(() => minorToMoney(-1n)).toThrow();
    expect(() => multiplyMoney('10', -1)).toThrow();
    expect(() => multiplyMoney('10', 1.5)).toThrow();
  });
});
