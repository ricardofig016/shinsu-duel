import dotenv from "dotenv";
import { createGameServer } from "./createGameServer.js";

dotenv.config();

const port = Number(process.env.PORT) || 3000;
const { server } = createGameServer();
server.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
