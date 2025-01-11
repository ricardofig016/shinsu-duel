import fs from "fs-extra";

export const readJsonFile = async (filePath) => {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      // File does not exist, create it and populate with an empty JSON object
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
