import express from "express";
import path from "node:path";
import cardsData from "../data/cards.json" with { type: "json" };
import deckLibrary from "../decks/deckLibrary.js";
import { DECK_NAME_PROBLEM, deckLimits, normalizeDeckName, validateDeckCards } from "../decks/deckValidation.js";
import authGate from "./authentication.js";

/**
 * Deck collection routes. Storage is owner-scoped, so a request can only ever
 * reach the session user's own decks.
 *
 * A deck may be saved with rule violations (they are flagged and keep the deck
 * out of non-dev games), but never with card ids that resolve to nothing: the
 * engine cannot build such a deck in any room. Legality is recomputed on every
 * read, because the catalog can change between saves.
 *
 * @param {{ library?: object, catalog?: object, gate?: object }} [options]
 *   `gate` is the session gate, injectable so tests can point it at a
 *   temporary accounts file.
 */
export function createDecksRouter({ library = deckLibrary, catalog = cardsData, gate = authGate } = {}) {
  const router = express.Router();
  const { requireApiSession, requirePageSession } = gate;

  const present = (deck) => ({
    id: deck.id,
    name: deck.name,
    cards: deck.cards,
    updatedAt: deck.updatedAt ?? null,
    ...validateDeckCards(deck.cards, catalog),
  });

  // Async handlers funnel rejections into express's error handling instead of
  // leaving the request hanging on an unhandled rejection.
  const route = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

  router.get("/", requirePageSession, (req, res) => {
    res.sendFile(path.resolve("public", "pages", "decks", "index.html"));
  });

  router.get(
    "/data",
    requireApiSession,
    route(async (req, res) => {
      const decks = await library.listDecks(req.session.username);
      res.json({ decks: decks.map(present), limits: deckLimits() });
    })
  );

  router.post("/validate", requireApiSession, (req, res) => {
    res.json(validateDeckCards(req.body?.cards, catalog));
  });

  router.post(
    "/",
    requireApiSession,
    route(async (req, res) => {
      const name = normalizeDeckName(req.body?.name);
      if (!name) return res.status(400).json({ message: DECK_NAME_PROBLEM });

      const validation = validateDeckCards(req.body?.cards, catalog);
      if (!validation.buildable) {
        return res.status(400).json({ message: "Deck contains cards that do not exist.", problems: validation.problems });
      }

      const deck = await library.createDeck({ owner: req.session.username, name, cards: req.body.cards });
      res.status(201).json({ deck: present(deck) });
    })
  );

  router.put(
    "/:id",
    requireApiSession,
    route(async (req, res) => {
      const name = normalizeDeckName(req.body?.name);
      if (!name) return res.status(400).json({ message: DECK_NAME_PROBLEM });

      const validation = validateDeckCards(req.body?.cards, catalog);
      if (!validation.buildable) {
        return res.status(400).json({ message: "Deck contains cards that do not exist.", problems: validation.problems });
      }

      const deck = await library.updateDeck(req.params.id, req.session.username, { name, cards: req.body.cards });
      if (!deck) return res.status(404).json({ message: "Deck not found." });
      res.json({ deck: present(deck) });
    })
  );

  router.delete(
    "/:id",
    requireApiSession,
    route(async (req, res) => {
      const deleted = await library.deleteDeck(req.params.id, req.session.username);
      if (!deleted) return res.status(404).json({ message: "Deck not found." });
      res.json({ deleted: true });
    })
  );

  return router;
}

export default createDecksRouter();
