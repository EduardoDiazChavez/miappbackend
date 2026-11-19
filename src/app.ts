import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import * as helmetModule from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { errorHandler } from "./middleware/errors.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { ticketsRouter } from "./routes/tickets.js";

export const app = express();

app.disable("x-powered-by");
app.use(helmetModule.default());
app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());
app.use(
  rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
);
app.use((request, _response, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
    const origin = request.get("origin");
    if (origin && origin !== config.FRONTEND_ORIGIN) {
      next(new Error("ORIGIN_NOT_ALLOWED"));
      return;
    }
  }
  next();
});

app.get("/health", (_request, response) => {
  response.json({ status: "ok" });
});
app.use("/auth", authRouter);
app.use("/tickets", ticketsRouter);
app.use("/admin", adminRouter);
app.use((_request, response) => {
  response.status(404).json({ error: "Ruta no encontrada." });
});
app.use(errorHandler);
