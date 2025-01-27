import express from "express";
import fs from "fs";
import path from "path";
import { getIconPath } from "../utils/file-util.js";

const router = express.Router();

const placeholderImagePath = "/assets/images/placeholder.png";

const getCardArtworkPath = (id) => {
  const directoryPath = path.resolve("public/assets/images/artworks/");
  const files = fs.readdirSync(directoryPath);
  const file = files.find((file) => file.startsWith(`${id}_`));
  return file ? `/assets/images/artworks/${file}` : placeholderImagePath;
};

router.get("/", (req, res) => {
  const cards = JSON.parse(fs.readFileSync(path.resolve("server/data/cards.json"), "utf-8"));
  const data = Object.keys(cards).map((id) => {
    const card = cards[id];
    card.artworkPath = getCardArtworkPath(id);
    return card;
  });
  res.json(data);
});

export default router;
