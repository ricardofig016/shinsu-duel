import express from "express";
import glossaryData from "../data/glossary.json" with { type: "json" };
import { RANKS } from "../game/ranks.js";

/**
 * Serves the client-facing tooltip glossary: the descriptive copy the UI
 * renders outside the card views (types, kinds, ranks, header concepts, HUD
 * strings, line labels). Tooltip copy is server-owned; the frontend only
 * looks entries up by code and styles them. Rank entries are composed from
 * the canonical rank catalog so the displayed cost ranges can't drift from
 * build-time validation; a missing rank copy fails at boot, not per request.
 */
const rankList = Object.entries(RANKS).map(([code, rank]) => {
  const copy = glossaryData.ranks[code];
  if (!copy) throw new Error(`Glossary is missing rank copy for "${code}".`);
  return {
    code,
    name: copy.name,
    description: copy.description,
    minCost: rank.minCost,
    maxCost: rank.maxCost,
  };
});

const glossary = {
  ...glossaryData,
  ranks: { title: glossaryData.ranks.title, concept: glossaryData.ranks.concept, list: rankList },
};

const router = express.Router();

router.get("/", (req, res) => {
  res.json(glossary);
});

export default router;
