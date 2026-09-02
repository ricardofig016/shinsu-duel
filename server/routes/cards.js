import express from "express";
import fs from "fs";
import path from "path";
import cardsData from "../data/cards.json" with { type: "json" };
import { buildCatalogViews, findOrphanArtworks, isTestCard } from "../utils/card-catalog.js";

const router = express.Router();

// The compiled catalog is a build artifact; card views are static per process.
const allCardViews = buildCatalogViews(cardsData, { includeTest: true });
const publicCardViews = allCardViews.filter((view) => !isTestCard(view));
const testCardViews = allCardViews.filter(isTestCard);

const artworksDirectory = path.resolve("public", "assets", "images", "artworks");
const ARTWORK_EXTENSION = ".png";

router.get("/data", (req, res) => {
  if (req.query.dev !== "true") {
    res.json({ cards: publicCardViews });
    return;
  }
  const artworkFileNames = fs
    .readdirSync(artworksDirectory)
    .filter((name) => name.endsWith(ARTWORK_EXTENSION))
    .sort();
  const orphanArtworks = findOrphanArtworks(allCardViews, artworkFileNames).map((fileName) => ({
    name: fileName.slice(0, -ARTWORK_EXTENSION.length),
    artworkPath: `/assets/images/artworks/${fileName}`,
  }));
  res.json({ cards: publicCardViews, testCards: testCardViews, orphanArtworks });
});

router.get("/", (req, res) => {
  res.sendFile(path.resolve("public", "pages", "cards", "index.html"));
});

export default router;
