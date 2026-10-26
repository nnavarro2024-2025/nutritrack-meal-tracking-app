import jwt from "jsonwebtoken"
import { User } from "../models/User.js"

export async function authenticateToken(request, response, next) {
  const authorization = request.get("authorization") || ""
  const [scheme, token] = authorization.split(" ")

  if (scheme !== "Bearer" || !token) {
    response.status(401).json({ error: "Authentication required.", code: "AUTH_REQUIRED" })
    return
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (typeof payload !== "object" || typeof payload.sub !== "string") {
      response.status(401).json({ error: "Invalid authentication token.", code: "INVALID_TOKEN" })
      return
    }
    const user = await User.findById(payload.sub).select("name email role assignedDietitian")
    if (!user) {
      response.status(401).json({ error: "Invalid authentication token.", code: "INVALID_TOKEN" })
      return
    }
    request.user = user
    next()
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      response.status(401).json({ error: "Your session has expired. Please log in again.", code: "TOKEN_EXPIRED" })
      return
    }
    if (error instanceof jwt.JsonWebTokenError) {
      response.status(401).json({ error: "Invalid authentication token.", code: "INVALID_TOKEN" })
      return
    }
    next(error)
  }
}

export function requireRole(role) {
  return (request, response, next) => {
    if (request.user?.role !== role) {
      response.status(403).json({ error: `${role === "dietitian" ? "A dietitian" : "This account"} role is required.`, code: "FORBIDDEN" })
      return
    }
    next()
  }
}
