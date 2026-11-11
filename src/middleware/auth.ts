import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { AuthenticatedUser, Role } from "../domain/roles.js";
import { User } from "../models/User.js";

declare global {
  // Express request types require namespace merging for application properties.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function requireAuth(request: Request, response: Response, next: NextFunction) {
  const token = request.cookies?.miapp_session;
  if (typeof token !== "string") {
    response.status(401).json({ error: "Debes iniciar sesión." });
    return;
  }

  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET, {
      issuer: "miapp-api",
      audience: "miapp-web",
    });
  } catch {
    response.status(401).json({ error: "La sesión expiró o no es válida." });
    return;
  }

  try {
    if (
      typeof payload === "string" ||
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string"
    ) {
      response.status(401).json({ error: "La sesión no es válida." });
      return;
    }

    const user = await User.findOne({ _id: payload.sub, active: true });
    if (!user) {
      response.clearCookie("miapp_session", {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: config.COOKIE_SAME_SITE,
        path: "/",
      });
      response.status(401).json({ error: "La cuenta ya no está activa." });
      return;
    }

    request.user = {
      id: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role as Role,
      ...(user.organizationId
        ? { organizationId: String(user.organizationId) }
        : {}),
    };
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRoles(...roles: Role[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!request.user || !roles.includes(request.user.role)) {
      response.status(403).json({ error: "No tienes permiso para esta operación." });
      return;
    }
    next();
  };
}
