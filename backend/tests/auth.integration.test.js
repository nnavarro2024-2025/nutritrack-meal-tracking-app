import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import jwt from "jsonwebtoken"
import mongoose from "mongoose"
import bcrypt from "bcryptjs"
import { User } from "../models/User.js"

const backendDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..")
dotenv.config({ path: resolve(backendDirectory, ".env") })
const baseUrl = process.env.API_URL || "http://localhost:3001"
const testEmail = `auth-test-${Date.now()}@example.test`
const testPassword = "TestPass2026!"
let consumerToken
let consumerId
let dietitianToken

before(() => {
  execFileSync(process.execPath, [resolve(backendDirectory, "seed.js")], {
    cwd: backendDirectory,
    env: process.env,
    stdio: "pipe",
  })
})

after(async () => {
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  await User.deleteOne({ email: testEmail })
  await mongoose.disconnect()
})

async function request(path, { token, ...options } = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
}

test("a. register a consumer and verify a stored password hash", async () => {
  const response = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Integration Consumer", email: testEmail, password: testPassword, role: "consumer" }),
  })
  assert.equal(response.status, 201)
  const body = await response.json()
  assert.equal(body.user.role, "consumer")
  assert.equal(JSON.stringify(body).includes("passwordHash"), false)
  consumerId = body.user.id
  consumerToken = body.token
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const storedUser = await User.findById(consumerId).select("+passwordHash")
  assert.ok(storedUser.passwordHash.startsWith("$2"))
  assert.notEqual(storedUser.passwordHash, testPassword)
  assert.equal(await bcrypt.compare(testPassword, storedUser.passwordHash), true)
  await mongoose.disconnect()
})

test("b. reject a duplicate email with a clear message", async () => {
  const response = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ name: "Duplicate Consumer", email: testEmail, password: testPassword, role: "consumer" }),
  })
  assert.equal(response.status, 409)
  assert.match((await response.json()).error, /already exists/i)
})

test("c. correct login returns a one-day JWT and public user fields", async () => {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(body.token)
  assert.equal(body.user.id, consumerId)
  assert.equal(body.user.name, "Integration Consumer")
  assert.equal(body.user.role, "consumer")
  assert.equal(JSON.stringify(body).includes("passwordHash"), false)
  assert.equal(jwt.decode(body.token).exp - jwt.decode(body.token).iat, 86400)
  consumerToken = body.token
})

test("d. wrong password is rejected without returning a token", async () => {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: testEmail, password: "WrongPass2026!" }),
  })
  assert.equal(response.status, 401)
  const body = await response.json()
  assert.match(body.error, /incorrect/i)
  assert.equal(body.token, undefined)
})

test("e. /me returns the current user without passwordHash", async () => {
  const response = await request("/api/auth/me", { token: consumerToken })
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.user, { id: consumerId, name: "Integration Consumer", role: "consumer" })
  assert.equal(JSON.stringify(body).includes("passwordHash"), false)
})

test("f. /me rejects missing, malformed, and expired tokens with 401", async () => {
  assert.equal((await request("/api/auth/me")).status, 401)
  assert.equal((await request("/api/auth/me", { token: "not.a.valid.jwt" })).status, 401)
  const expiredToken = jwt.sign({ sub: consumerId }, process.env.JWT_SECRET, { expiresIn: "-1s" })
  const response = await request("/api/auth/me", { token: expiredToken })
  assert.equal(response.status, 401)
  assert.equal((await response.json()).code, "TOKEN_EXPIRED")
})

test("g. consumers cannot validate clinical notes", async () => {
  const response = await request("/api/notes/validate", {
    method: "POST",
    token: consumerToken,
    body: "{}",
  })
  assert.equal(response.status, 403)
})

test("h. dietitians can validate valid and invalid notes", async () => {
  const login = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "dietitian@nutritrack.demo", password: "DietitianDemo2026!" }),
  })
  assert.equal(login.status, 200, "run npm run seed before this test")
  dietitianToken = (await login.json()).token
  const validNote = JSON.parse(await readFile(resolve(backendDirectory, "../schemas/examples/valid-note.json"), "utf8"))
  const invalidNote = JSON.parse(await readFile(resolve(backendDirectory, "../schemas/examples/invalid-note.json"), "utf8"))
  assert.equal((await request("/api/notes/validate", { method: "POST", token: dietitianToken, body: JSON.stringify(validNote) })).status, 200)
  assert.equal((await request("/api/notes/validate", { method: "POST", token: dietitianToken, body: JSON.stringify(invalidNote) })).status, 400)
})

test("i. note validation requires a token", async () => {
  assert.equal((await request("/api/notes/validate", { method: "POST", body: "{}" })).status, 401)
})

test("j. wearable and terminology endpoints remain open", async () => {
  const daily = await request("/api/wearable/daily?date=2026-10-26")
  assert.equal(daily.status, 200)
  assert.equal((await daily.json()).date, "2026-10-26")
  const week = await request("/api/wearable/week")
  assert.equal(week.status, 200)
  assert.equal((await week.json()).length, 7)
  assert.equal((await request("/api/terminology")).status, 200)
})

test("k. seed script is idempotent and assigns consumers to the demo dietitian", async () => {
  for (let run = 0; run < 2; run += 1) {
    execFileSync(process.execPath, [resolve(backendDirectory, "seed.js")], {
      cwd: backendDirectory,
      env: process.env,
      stdio: "pipe",
    })
  }

  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  const accounts = await User.find({
    email: { $in: ["dietitian@nutritrack.demo", "alex@nutritrack.demo", "jordan@nutritrack.demo"] },
  })
  assert.equal(accounts.length, 3)
  const dietitian = accounts.find((user) => user.email === "dietitian@nutritrack.demo")
  const consumers = accounts.filter((user) => user.role === "consumer")
  assert.equal(consumers.length, 2)
  assert.ok(consumers.every((user) => user.assignedDietitian?.toString() === dietitian._id.toString()))
  await mongoose.disconnect()
})
