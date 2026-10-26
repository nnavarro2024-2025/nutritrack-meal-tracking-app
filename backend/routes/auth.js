import { Router } from "express"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import mongoose from "mongoose"
import { User } from "../models/User.js"
import { authenticateToken } from "../middleware/auth.js"

const router = Router()
const publicUser = (user) => ({
  id: user._id.toString(),
  name: user.name,
  role: user.role,
})
const createToken = (user) => jwt.sign(
  { sub: user._id.toString() },
  process.env.JWT_SECRET,
  { expiresIn: "1d" },
)

router.post("/register", async (request, response) => {
  const { name, email, password, role = "consumer", assignedDietitian } = request.body || {}
  if (
    typeof name !== "string" ||
    name.trim().length < 2 ||
    typeof email !== "string" ||
    !/^\S+@\S+\.\S+$/.test(email.trim()) ||
    typeof password !== "string" ||
    password.length < 8 ||
    !["consumer", "dietitian"].includes(role)
  ) {
    response.status(400).json({
      error: "Provide a name, valid email, password of at least 8 characters, and a valid role.",
      code: "INVALID_REGISTRATION",
    })
    return
  }

  try {
    const normalizedEmail = email.trim().toLowerCase()
    if (await User.exists({ email: normalizedEmail })) {
      response.status(409).json({ error: "An account with this email already exists.", code: "DUPLICATE_EMAIL" })
      return
    }

    let dietitianId
    if (assignedDietitian) {
      if (role !== "consumer" || !mongoose.isValidObjectId(assignedDietitian)) {
        response.status(400).json({ error: "A valid assigned dietitian is only allowed for consumers.", code: "INVALID_DIETITIAN" })
        return
      }
      const dietitian = await User.findOne({ _id: assignedDietitian, role: "dietitian" })
      if (!dietitian) {
        response.status(400).json({ error: "The assigned dietitian was not found.", code: "INVALID_DIETITIAN" })
        return
      }
      dietitianId = dietitian._id
    }

    // Role selection is permitted for this school demo; a real system must not let users self-register as dietitians.
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      role,
      ...(dietitianId ? { assignedDietitian: dietitianId } : {}),
    })
    response.status(201).json({ token: createToken(user), user: publicUser(user) })
  } catch (error) {
    if (error?.code === 11000) {
      response.status(409).json({ error: "An account with this email already exists.", code: "DUPLICATE_EMAIL" })
      return
    }
    throw error
  }
})

router.post("/login", async (request, response) => {
  const { email, password } = request.body || {}
  if (typeof email !== "string" || typeof password !== "string") {
    response.status(400).json({ error: "Email and password are required.", code: "MISSING_CREDENTIALS" })
    return
  }

  const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+passwordHash")
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    response.status(401).json({ error: "Email or password is incorrect.", code: "INVALID_CREDENTIALS" })
    return
  }

  response.json({ token: createToken(user), user: publicUser(user) })
})

router.get("/me", authenticateToken, (request, response) => {
  response.json({ user: publicUser(request.user) })
})

export default router
