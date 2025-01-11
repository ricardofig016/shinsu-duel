import express from "express";
import playRoutes from "./play.js";
import rulesRoutes from "./rules.js";
import gameRoutes from "./game.js";

const router = express.Router();

router.use("/play", playRoutes);
router.use("/rules", rulesRoutes);
router.use("/game", gameRoutes);

export default router;
