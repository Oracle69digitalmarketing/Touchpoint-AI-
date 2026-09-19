/**
 * PHASE 13B: MONEY (exact integer minor units)
 *
 * Settlement values never enter floating-point arithmetic. Orders store money
 * as NUMERIC(14,2) decimals; the payment-provider boundary uses exact integer
 * minor units (kobo/cents/…). This module converts the two with strict
 * decimal-string parsing and a per-currency exponent map — never with `%` or
 * `Math.round` on a float, which is how 0.1 + 0.2 type drift leaks in.
 */
const CURRENCY_EXPONENTS = Object.freeze({
  NGN: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  INR: 2,
  JPY: 0,
});

export function currencyExponent(currency) {
  const exponent = CURRENCY_EXPONENTS[String(currency || '').toUpperCase()];
  if (exponent === undefined) {
    throw new Error(`Unsupported currency for minor-unit conversion: ${currency}`);
  }
  return exponent;
}

/**
 * Converts a decimal amount (string, number, or whole twos-complement) into
 * exact integer minor units for the given currency.
 *
 * - `"34.00"` (NUMERIC serialization) -> 3400 for NGN/2dp, 34 for JPY/0dp.
 * - `8.5` -> 850 for NGN.
 * - Rejects negative values, ISO/space junk, over-precision (more fractional
 *   digits than the currency supports), and amounts that overflow the safe
 *   integer range (the NUMERIC(14,2) maximum converts well within it).
 */
export function decimalToMinorUnits(value, currency) {
  if (value === null || value === undefined) throw new Error('Amount is required');
  const exponent = currencyExponent(currency);
  const raw = typeof value === 'number' ? String(value) : String(value).trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid decimal amount: ${raw}`);
  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [whole = '0', fraction = ''] = unsigned.split('.');
  if (fraction.length > exponent) {
    throw new Error(`Amount has more decimal places than ${currency} supports (${exponent})`);
  }
  const scaled = whole + fraction.padEnd(exponent, '0');
  const minor = Number(scaled);
  if (!Number.isSafeInteger(minor)) throw new Error('Amount out of safe integer range');
  return negative ? -minor : minor;
}

/**
 * Whether two decimal strings represent the same money in the same currency.
 * Used by tests to express expectation without floating-point.
 */
export function decimalAmountsEqual(a, b, currency) {
  try {
    return decimalToMinorUnits(a, currency) === decimalToMinorUnits(b, currency);
  } catch {
    return false;
  }
}