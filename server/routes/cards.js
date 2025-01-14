import express from "express";
import fs from "fs";
import path from "path";

const router = express.Router();

const placeholderImagePath = "/assets/images/placeholder.png";
const positions = {
  fisherman: "Fisherman",
  lightbearer: "Light Bearer",
  scout: "Scout",
  spearbearer: "Spear Bearer",
  wavecontroller: "Wave Controller",
};
const traits = {};

const getCardData = (id) => {
  const cards = JSON.parse(fs.readFileSync(path.resolve("server/data/cards.json"), "utf-8"));
  return cards.find((card) => card.id === parseInt(id));
};

const getCardArtworkPath = (id) => {
  const directoryPath = path.resolve("public/assets/images/artworks/");
  const files = fs.readdirSync(directoryPath);
  const file = files.find((file) => file.startsWith(`${id}_`));
  return file ? `/assets/images/artworks/${file}` : placeholderImagePath;
};

const getPositionIconPath = (positionCode) => {
  const directoryPath = path.resolve("public/assets/icons/positions/");
  const files = fs.readdirSync(directoryPath);
  const file = files.find((file) => file === `${positionCode}.png`);
  return file ? `/assets/icons/positions/${file}` : placeholderImagePath;
  return icons;
};

router.get("/:id", (req, res) => {
  const { id } = req.params;
  let data = getCardData(id);
  if (!data) return res.status(404).send(`Card with id ${id} not found`);

  data.artworkPath = getCardArtworkPath(id);
  data.positions = {};
  for (let code of data.positionCodes) {
    data.positions[code] = {};
    data.positions[code].name = positions[code];
    data.positions[code].iconPath = getPositionIconPath(code);
  }

  res.json(data);
});

export default router;
