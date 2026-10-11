/** Decimal input stays exact. A metric uses one common power-of-ten scale. */
export function decimalParts(
  text: string,
): Readonly<{ integer: bigint; places: number }> {
  if (!/^-?\d+(?:\.\d+)?$/.test(text))
    throw new Error('INVALID_SOURCE_DECIMAL');
  const places = text.includes('.') ? text.length - text.indexOf('.') - 1 : 0;
  if (places > 18) throw new Error('DECIMAL_PRECISION_UNSUPPORTED');
  return { integer: BigInt(text.replace('.', '')), places };
}
export function scaled(text: string, places: number): bigint {
  const value = decimalParts(text);
  if (value.places > places) throw new Error('INVALID_DECIMAL_SCALE');
  return value.integer * 10n ** BigInt(places - value.places);
}
export function decimalText(value: bigint, places: number): string {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value)
    .toString()
    .padStart(places + 1, '0');
  if (places === 0) return sign + digits;
  return (
    sign +
    (digits.slice(0, -places) + '.' + digits.slice(-places)).replace(
      /\.?0+$/,
      '',
    )
  );
}
export function fitsDifference(
  value: bigint,
  reference: bigint,
  minimum: number | undefined,
  maximum: number | undefined,
): boolean {
  if (reference === 0n) return false;
  const diff = value > reference ? value - reference : reference - value;
  const absolute = reference < 0n ? -reference : reference;
  const compare = (bound: number, lower: boolean) => {
    const parts = decimalParts(String(bound));
    const left = diff * 10n ** BigInt(parts.places),
      right = absolute * parts.integer;
    return lower ? left >= right : left <= right;
  };
  return (
    (minimum === undefined || compare(minimum, true)) &&
    (maximum === undefined || compare(maximum, false))
  );
}
