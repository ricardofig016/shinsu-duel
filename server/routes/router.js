import express from "express";
import authRoutes from "./auth.js";
import gameRoutes from "./game.js";
import playRoutes from "./play.js";
import rulesRoutes from "./rules.js";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/game", gameRoutes);
router.use("/play", playRoutes);
router.use("/rules", rulesRoutes);

export default router;
