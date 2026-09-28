/**
 * Деньги: в БД numeric(12,2), в API decimal-строка ("10000.00").
 * Вся арифметика — на целых minor-единицах (BigInt), float нигде не используется.
 * Правило округления Visit (час/минуты) сюда НЕ входит — определяется в Phase 2.
 */

const MONEY_RE = /^\d{1,10}(\.\d{1,2})?$/;

export const MONEY_PATTERN = '^\\d{1,10}(\\.\\d{1,2})?$';

export function isMoneyString(value: unknown): value is string {
  return typeof value === 'string' && MONEY_RE.test(value);
}

/** "10000.5" → 1000050n (minor-единицы: 1 ед. = 0.01) */
export function moneyToMinor(value: string): bigint {
  if (!isMoneyString(value)) {
    throw new Error(`Некорректная денежная сумма: ${String(value)}`);
  }
  const [whole, frac = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'));
}

/** 1000050n → "10000.50" */
export function minorToMoney(minor: bigint): string {
  if (minor < 0n) throw new Error('Отрицательная сумма недопустима');
  const whole = minor / 100n;
  const frac = (minor % 100n).toString().padStart(2, '0');
  return `${whole}.${frac}`;
}

/** Канонический вид для хранения и ответа: "10000" → "10000.00" */
export function normalizeMoney(value: string): string {
  return minorToMoney(moneyToMinor(value));
}

export function addMoney(a: string, b: string): string {
  return minorToMoney(moneyToMinor(a) + moneyToMinor(b));
}

/** Цена × целое количество (например, позиция чека). */
export function multiplyMoney(price: string, quantity: number): string {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new Error('Количество должно быть целым неотрицательным числом');
  }
  return minorToMoney(moneyToMinor(price) * BigInt(quantity));
}
