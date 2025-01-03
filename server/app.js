import express from "express";
import router from "./router.js";
import path from "path";

const app = express();

app.use(express.static(path.resolve("public")));

app.use("/", router);

const port = 3000;
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
