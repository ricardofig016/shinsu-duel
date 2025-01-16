import fs from "fs-extra";
import path from "path";

export const readJsonFile = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
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
  const directoryPath = path.resolve(`public/assets/icons/${folderName}/`);
  const files = fs.readdirSync(directoryPath);
  const file = files.find((file) => file === `${fileName}.png`);
  return file ? `/assets/icons/${folderName}/${file}` : placeholderImagePath;
};
