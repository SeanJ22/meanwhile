/**
 * Browser-safe, injective identity for an exact JavaScript venue string.
 *
 * Each UTF-16 code unit is emitted as exactly four lowercase hexadecimal
 * digits and the code-unit length is delimited ahead of the payload. Unlike a
 * UTF-8 conversion, this also distinguishes every possible JavaScript string,
 * including unpaired surrogates. This is an exact content encoding, not a
 * probabilistic digest, so two different raw publisher spellings cannot
 * collide.
 */
export function exactVenueMatchContentKey(value: string): string {
  let encoded = "";
  for (let index = 0; index < value.length; index += 1) {
    encoded += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return `utf16-${value.length.toString(16)}-${encoded}`;
}
