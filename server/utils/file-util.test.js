import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJsonFile, writeJsonFile } from "./file-util.js";

describe("readJsonFile", () => {
  let directory;
  const file = () => path.join(directory, "store.json");

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), "shinsu-file-util-"));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  test("parses a plain JSON file", async () => {
    await writeJsonFile(file(), { Alice: {} });

    expect(await readJsonFile(file())).toEqual({ Alice: {} });
  });

  test("creates a missing file as an empty store", async () => {
    const contents = await readJsonFile(file());

    expect(contents).toEqual({});
    expect(JSON.parse(fs.readFileSync(file(), "utf8"))).toEqual({});
  });

  // PowerShell's `Set-Content -Encoding utf8` and some editors write a mark.
  // Without stripping it, every later read of the file throws a parse error
  // that names the reader instead of the write that added the mark.
  test("parses a file written with a byte-order mark", async () => {
    fs.writeFileSync(file(), `\uFEFF${JSON.stringify({ Bob: {} })}`, "utf8");

    expect(await readJsonFile(file())).toEqual({ Bob: {} });
  });

  test("still throws on a genuinely malformed file", async () => {
    fs.writeFileSync(file(), "{ not json", "utf8");

    await expect(readJsonFile(file())).rejects.toThrow(SyntaxError);
  });
});
