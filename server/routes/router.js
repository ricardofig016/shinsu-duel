import express from "express";
import auth from "./auth.js";
import cards from "./cards.js";
import game from "./game.js";
import play from "./play.js";
import positions from "./positions.js";
import rules from "./rules.js";
import traits from "./traits.js";

const router = express.Router();

router.use("/auth", auth);
router.use("/cards", cards);
router.use("/game", game);
router.use("/play", play);
router.use("/positions", positions);
router.use("/rules", rules);
router.use("/traits", traits);

export default router;
