import express from "express";
import router from "./routes/router.js";
import path from "path";
import fs from "fs";
import morgan from "morgan";
import winston from "winston";

const app = express();

// logger
const accessLogStream = fs.createWriteStream(path.resolve("logs/access.log"), { flags: "a" });
app.use(morgan("combined", { stream: accessLogStream }));
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});
app.use((err, req, res, next) => {
  logger.error(`${err.status || 500} - ${err.message} - ${req.originalUrl} - ${req.method} - ${req.ip}`);
  next(err);
});

// static files
app.use(express.static(path.resolve("public")));

// routes
app.use("/", router);

const port = 3000;
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
