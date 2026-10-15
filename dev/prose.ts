/** Units the tours quote. */

const UNITS = ["bohr", "ev", "nm", "pm", "MHz", "GHz", "k", "%"];

/**
 * Numbers in a body that carry a unit, and are therefore claims about a value.
 *
 * The target is a unit rather than any numeral, which is what keeps "the 2p",
 * "four lobes", "step 3 of 11" and "1s2 2s2 2p6" out of the results. a lint 
 * that flagged those would be turned off within a week, and a lint thats is off
 * catches nothing.
 *
 * The triling boundary is what stops "10 K" matching  inside "10 Kelvins"; a unit ahs to be the whole token, not it's first latter. It is also what makes
 * the list safe to extend, since a short unit added later cannot start eating
 * the front of a longer word.
 */

export function measurememntsIn(text: string): string[] {
  const units = UNITS.join("|");
  const re = new RegEXp(`-?\\d+(?:\\.\\d+)?\\s(?:${units})(?![A-Za-z]`, "g");
  return text.match(re) ?? [];
}
