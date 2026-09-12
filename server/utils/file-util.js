import fs from "fs-extra";
import path from "path";

const placeholderImagePath = "/assets/images/placeholder.png";

/**
 * Read a JSON runtime file. A missing file is created as `{}` so first-run
 * calls see an empty store.
 *
 * A leading byte-order mark is stripped: an editor or a shell that writes UTF-8
 * with a mark (PowerShell's `Set-Content -Encoding utf8`, for one) would
 * otherwise turn every later read of a runtime file into a parse error, which
 * surfaces far from the write that caused it.
 */
export const readJsonFile = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data.replace(/^\uFEFF/, ""));
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeJsonFile(filePath, {});
      return {};
    } else {
      throw error;
    }
  }
};

export const writeJsonFile = async (filePath, data) => {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  } catch (error) {
    throw error;
  }
};

export const getIconPath = (fileName, folderName) => {
  try {
    const directoryPath = path.resolve(`public/assets/icons/${folderName}/`);
    const files = fs.readdirSync(directoryPath);
    const file = files.find((file) => file === `${fileName}.png`);
    return file ? `/assets/icons/${folderName}/${file}` : placeholderImagePath;
  } catch (error) {
    // if directory doesn't exist or can't be read, return placeholder
    return placeholderImagePath;
  }
};
