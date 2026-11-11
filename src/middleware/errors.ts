import type { ErrorRequestHandler } from "express";
import mongoose from "mongoose";
import { ZodError } from "zod";

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
  void _next;
  if (error instanceof ZodError) {
    response.status(400).json({ error: "Los datos enviados no son válidos.", details: error.issues });
    return;
  }

  if (error instanceof mongoose.Error.ValidationError) {
    response.status(400).json({ error: "Los datos no cumplen las reglas del servidor." });
    return;
  }

  if (error instanceof Error && error.message === "ORIGIN_NOT_ALLOWED") {
    response.status(403).json({ error: "Origen no permitido." });
    return;
  }

  console.error("API request failed:", error);
  response.status(500).json({ error: "Ocurrió un error interno." });
};
