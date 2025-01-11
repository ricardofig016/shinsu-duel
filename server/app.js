import express from "express";
import session from "express-session";
import router from "./routes/router.js";
import path from "path";
import dotenv from "dotenv";
import crypto from "crypto";
import fs from "fs";
import morgan from "morgan";
import winston from "winston";

dotenv.config();
const app = express();

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionSecret = process.env.SESSION_SECRET || crypto.randomBytes(64).toString("hex");
app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // set to true if using HTTPS
  })
);

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

app.use(express.static(path.resolve("public")));
app.use("/", router);

const port = 3000;
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
