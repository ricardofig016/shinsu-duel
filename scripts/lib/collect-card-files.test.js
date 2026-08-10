import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { collectCardFiles, relativeCardPath } from "./collect-card-files.js";

describe("collectCardFiles", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "shinsu-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeFile(relPath, content = "type: unit\nname: test") {
    const full = path.join(tmpDir, relPath);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, content, "utf-8");
  }

  test("finds yml and yaml files", async () => {
    await writeFile("a.yml");
    await writeFile("b.yaml");
    await writeFile("c.txt"); // should be ignored

    const files = await collectCardFiles(tmpDir);
    expect(files).toHaveLength(2);
    expect(files.map((f) => path.basename(f)).sort()).toEqual(["a.yml", "b.yaml"]);
  });

  test("recurses into subdirectories", async () => {
    await writeFile("a.yml");
    await writeFile("sub/b.yml");
    await writeFile("sub/deep/c.yml");

    const files = await collectCardFiles(tmpDir);
    expect(files).toHaveLength(3);
    const names = files.map((f) => path.relative(tmpDir, f).replaceAll(path.sep, "/")).sort();
    expect(names).toEqual(["a.yml", "sub/b.yml", "sub/deep/c.yml"]);
  });

  test("returns empty array for empty directory", async () => {
    const files = await collectCardFiles(tmpDir);
    expect(files).toEqual([]);
  });

  test("returns sorted paths", async () => {
    await writeFile("z.yml");
    await writeFile("a.yml");
    await writeFile("m.yml");

    const files = await collectCardFiles(tmpDir);
    const names = files.map((f) => path.basename(f));
    expect(names).toEqual(["a.yml", "m.yml", "z.yml"]);
  });

  test("ignores non-yml files", async () => {
    await writeFile("card.json");
    await writeFile("notes.md");
    await writeFile("image.png");

    const files = await collectCardFiles(tmpDir);
    expect(files).toEqual([]);
  });

  test("handles empty subdirectories", async () => {
    await writeFile("a.yml");
    await fs.mkdir(path.join(tmpDir, "empty"));

    const files = await collectCardFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(path.basename(files[0])).toBe("a.yml");
  });
});

describe("relativeCardPath", () => {
  test("returns relative path from cwd", () => {
    const abs = path.join(process.cwd(), "data", "cards", "test.yml");
    expect(relativeCardPath(abs)).toBe(path.join("data", "cards", "test.yml"));
  });
});
