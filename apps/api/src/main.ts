import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 4000);

app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(pinoHttp());

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "devinsight-api"
  });
});

app.listen(port, () => {
  console.log(`DevInsight API listening on port ${port}`);
});
