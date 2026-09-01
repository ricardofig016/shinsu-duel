/**
 * Deep state diff for the replay artifact.
 *
 * `computeStateDiff(before, after)` walks two fully serialized game states
 * (`GameState.toSerializedState()` outputs) and returns the minimal change
 * set that turns `before` into `after`:
 *
 *   { changed: { "<dotted.path>": value }, removed: ["<dotted.path>"] }
 *
 * Paths are dotted (`players.tester1.deck.3.cardId`); array indices are
 * positions, so array comparison is positional and removals are always the
 * trailing indices. A key that only exists in `after` is stored whole under
 * its path. The serialized state's key set is stable across a game, so
 * `applyStateDiff` never needs to invent parents: a path whose parent is
 * missing is a malformed diff and throws loudly instead of silently
 * producing a wrong state.
 */

function isObject(value) {
  return value !== null && typeof value === "object";
}

function childPath(prefix, key) {
  return prefix ? `${prefix}.${key}` : `${key}`;
}

/** @returns {{ changed: Object<string, any>, removed: string[] }} */
export function computeStateDiff(before, after) {
  if (!isObject(before) || !isObject(after)) {
    throw new TypeError("computeStateDiff needs two state objects.");
  }
  const changed = {};
  const removed = [];
  walk(before, after, "", changed, removed);
  return { changed, removed };
}

function walk(before, after, prefix, changed, removed) {
  // A type change (or an object met by a scalar) replaces the whole value.
  if (!isObject(before) || !isObject(after) || Array.isArray(before) !== Array.isArray(after)) {
    if (before !== after) changed[prefix] = after;
    return;
  }

  if (Array.isArray(before)) {
    const common = Math.min(before.length, after.length);
    for (let i = 0; i < common; i += 1) {
      walk(before[i], after[i], childPath(prefix, i), changed, removed);
    }
    for (let i = common; i < before.length; i += 1) removed.push(childPath(prefix, i));
    for (let i = common; i < after.length; i += 1) changed[childPath(prefix, i)] = after[i];
    return;
  }

  for (const key of Object.keys(before)) {
    if (!(key in after)) {
      removed.push(childPath(prefix, key));
      continue;
    }
    walk(before[key], after[key], childPath(prefix, key), changed, removed);
  }
  for (const key of Object.keys(after)) {
    if (!(key in before)) changed[childPath(prefix, key)] = after[key];
  }
}

/**
 * Apply a diff produced by `computeStateDiff` to a state object and return
 * the resulting state. The input state is never mutated.
 *
 * @param {object} state
 * @param {{ changed: Object<string, any>, removed: string[] }} diff
 * @returns {object} a new state with the diff applied
 */
export function applyStateDiff(state, diff) {
  if (!isObject(state)) throw new TypeError("applyStateDiff needs a state object.");
  if (!isObject(diff) || !isObject(diff.changed) || !Array.isArray(diff.removed)) {
    throw new TypeError("applyStateDiff needs a { changed, removed } diff.");
  }

  const result = structuredClone(state);

  for (const path of Object.keys(diff.changed)) {
    setPath(result, path, diff.changed[path]);
  }

  // Removed paths are grouped per parent: object keys delete one by one,
  // while an array truncates exactly once to the lowest removed index.
  // computeStateDiff only ever marks the trailing indices, and apply
  // validates that invariant loudly instead of silently truncating wrong.
  const removalsByParent = new Map();
  for (const path of diff.removed) {
    if (typeof path !== "string") throw new TypeError("applyStateDiff removed paths must be strings.");
    const segments = path.split(".");
    const leaf = segments.pop();
    const parent = resolveContainer(result, segments, path);
    if (Array.isArray(parent)) {
      const index = Number(leaf);
      if (!Number.isInteger(index)) {
        throw new Error(`stateDiff: removed path "${path}" is not an array index.`);
      }
      let group = removalsByParent.get(parent);
      if (!group) {
        group = [];
        removalsByParent.set(parent, group);
      }
      group.push(index);
    } else {
      if (!(leaf in parent)) {
        throw new Error(`stateDiff: cannot remove path "${path}" — the path does not exist.`);
      }
      delete parent[leaf];
    }
  }

  for (const [array, indices] of removalsByParent) {
    const min = Math.min(...indices);
    const max = Math.max(...indices);
    const trailing = min + indices.length - 1 === max && max === array.length - 1;
    if (!trailing) {
      throw new Error(`stateDiff: removed array indices must be the trailing block ending at the last index (path indices ${indices.join(", ")} against length ${array.length}).`);
    }
    array.length = min;
  }

  return result;
}

function resolveContainer(root, segments, path) {
  let current = root;
  for (let i = 0; i < segments.length; i += 1) {
    const next = current[segments[i]];
    if (!isObject(next)) {
      throw new Error(`stateDiff: path "${path}" is malformed — "${segments[i]}" (segment ${i}) is not an object.`);
    }
    current = next;
  }
  return current;
}

function setPath(root, path, value) {
  const segments = path.split(".");
  let current = root;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const next = current[segments[i]];
    if (!isObject(next)) {
      throw new Error(`stateDiff: cannot set path "${path}" — "${segments[i]}" (segment ${i}) is not an object.`);
    }
    current = next;
  }
  const leaf = segments[segments.length - 1];
  if (Array.isArray(current)) {
    const index = Number(leaf);
    // Assignments may replace an element or append exactly at the end;
    // anything beyond that would punch a sparse hole, which no well-formed
    // diff produces.
    if (Number.isInteger(index) && index > current.length) {
      throw new Error(`stateDiff: cannot set array index "${path}" beyond the array's length.`);
    }
  }
  current[leaf] = value;
}
