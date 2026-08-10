import fs from "node:fs/promises";
import path from "node:path";

/**
 * Recursively collect YAML card files from a directory.
 * Supports nested subdirectories for card organization.
 * Files are sorted for deterministic ordering across compilers and validators.
 *
 * @param {string} rootDir - absolute path to the cards directory
 * @returns {Promise<string[]>} sorted array of absolute file paths
 */
export async function collectCardFiles(rootDir) {
  const results = [];

  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml"))) {
        results.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  results.sort();
  return results;
}

/**
 * Compute a relative path from cwd for display purposes.
 *
 * @param {string} absolutePath
 * @returns {string}
 */
export function relativeCardPath(absolutePath) {
  return path.relative(process.cwd(), absolutePath);
}
