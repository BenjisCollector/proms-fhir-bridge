/**
 * NHS number Modulus 11 check (NHS Data Dictionary). Rejecting bad numbers locally
 * avoids a wasted call and stops typos ever reaching PDS.
 */
export function isValidNhsNumber(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 9).reduce((acc, d, i) => acc + d * (10 - i), 0);
  const check = 11 - (sum % 11);
  if (check === 10) return false;
  return (check === 11 ? 0 : check) === digits[9];
}
