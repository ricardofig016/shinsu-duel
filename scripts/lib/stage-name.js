/**
 * Evolution stage markers: the Roman-numeral suffix convention that links an
 * evolved unit to its base at compile time.
 *
 * Convention: an evolved card is named `<root> <stage>` where `<root>` is the
 * base card's full name and `<stage>` is a Roman numeral ≥ II. A stage-2 card
 * is `Beta II`; a stage-3 card (evolved from `Beta II`) is `Beta III`. The
 * numeral is the only link carrier — no other suffix form is recognized.
 *
 * Consumers:
 * - card-compile.js resolves `evolve:` targets and `evolvedFrom` back-references.
 * - card-validate.js checks that stage-marked names have a resolvable parent.
 */

const ROMAN_VALUES = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };

// Canonical subtractive-form Roman numerals only.
const ROMAN_PATTERN = /^(?=[MDCLXVI])M*(C[MD]|D?C{0,3})(X[CL]|L?X{0,3})(I[VX]|V?I{0,3})$/;

// Stage I is the base card itself, so markers start at II. The upper bound
// keeps ordinary words that happen to be large Roman numerals (e.g. "MIX")
// from being misread as stage markers.
export const MIN_STAGE = 2;
export const MAX_STAGE = 12;

function romanToInt(numeral) {
  let total = 0;
  for (let i = 0; i < numeral.length; i++) {
    const value = ROMAN_VALUES[numeral[i]];
    const next = ROMAN_VALUES[numeral[i + 1]];
    total += next > value ? -value : value;
  }
  return total;
}

export function intToRoman(value) {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`Expected a positive integer, got ${value}`);
  }
  const numerals = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let remaining = value;
  let result = "";
  for (const [threshold, numeral] of numerals) {
    while (remaining >= threshold) {
      result += numeral;
      remaining -= threshold;
    }
  }
  return result;
}

/**
 * Parses a card name's trailing evolution stage marker.
 *
 * @param {string} name - card display name, e.g. "Beta II"
 * @returns {{ root: string, stage: number } | null} the root name with the
 *   marker stripped and the stage number, or null when the name carries no
 *   stage marker (a base card).
 */
export function parseStage(name) {
  const match = /\s+([^\s]+)$/.exec(name.trim());
  if (!match) return null;
  const token = match[1].toUpperCase();
  if (!ROMAN_PATTERN.test(token)) return null;
  const stage = romanToInt(token);
  if (stage < MIN_STAGE || stage > MAX_STAGE) return null;
  return { root: name.slice(0, match.index).trimEnd(), stage };
}

/**
 * Builds the card name for a stage of a root name.
 *
 * @param {string} rootName - root card name, e.g. "Beta"
 * @param {number} stage - stage number ≥ 2, e.g. 3
 * @returns {string} stage name, e.g. "Beta III"
 */
export function stageName(rootName, stage) {
  if (!Number.isInteger(stage) || stage < MIN_STAGE) {
    throw new Error(`Expected a stage ≥ ${MIN_STAGE}, got ${stage}`);
  }
  return `${rootName} ${intToRoman(stage)}`;
}
