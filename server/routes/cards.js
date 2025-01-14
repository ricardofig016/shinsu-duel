import express from "express";
import fs from "fs";
import { get } from "http";
import path from "path";

const router = express.Router();

const getCardData = (id) => {
  const cards = JSON.parse(fs.readFileSync(path.resolve("server/data/cards.json"), "utf-8"));
  return cards.find((card) => card.id === parseInt(id));
};

const getCardArtworkPath = (id) => {
  const directoryPath = path.resolve("public/assets/images/artworks/");
  const files = fs.readdirSync(directoryPath);
  const file = files.find((file) => file.startsWith(`${id}_`));
  return file ? `/assets/images/artworks/${file}` : "/assets/images/artworks/placeholder.png";
};

router.get("/:id", (req, res) => {
  const { id } = req.params;

  let data = getCardData(id);
  data.artworkPath = getCardArtworkPath(id);
  res.json(data);
});

export default router;
