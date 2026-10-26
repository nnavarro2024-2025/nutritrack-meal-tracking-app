import cors from "cors"
import express from "express"

const app = express()
const port = Number(process.env.PORT || 3001)

function isAllowedOrigin(origin) {
  let url
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  if (url.protocol !== "http:" || !["5173", "8443"].includes(url.port)) return false

  const hostname = url.hostname.toLowerCase()
  if (hostname === "localhost" || hostname === "::1") return true

  const octets = hostname.split(".").map(Number)
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false
  }
  const [first, second] = octets
  return (
    first === 127 ||
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

app.use(cors({
  origin(origin, callback) {
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true)
      return
    }
    callback(new Error("Origin is not allowed by CORS"))
  },
}))

function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(`${date}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function createRandom(seed) {
  let value = 2166136261
  for (const character of seed) {
    value = Math.imul(value ^ character.charCodeAt(0), 16777619)
  }
  return () => {
    value += 0x6d2b79f5
    let number = value
    number = Math.imul(number ^ (number >>> 15), number | 1)
    number ^= number + Math.imul(number ^ (number >>> 7), number | 61)
    return ((number ^ (number >>> 14)) >>> 0) / 4294967296
  }
}

function getDailyData(date) {
  const random = createRandom(date)
  const steps = 3000 + Math.floor(random() * 11001)
  const activeEnergyKcal = 150 + Math.floor(random() * 751)
  const distanceKm = Number((steps * (0.00065 + random() * 0.00015)).toFixed(2))

  return {
    date,
    steps,
    activeEnergyKcal,
    distanceKm,
    lastSynced: new Date().toISOString(),
  }
}

app.get("/api/wearable/daily", (request, response) => {
  const date = request.query.date
  if (typeof date !== "string" || !isValidDate(date)) {
    response.status(400).json({
      error: "A valid date query parameter is required in YYYY-MM-DD format.",
    })
    return
  }

  response.json(getDailyData(date))
})

app.get("/api/wearable/week", (_request, response) => {
  const today = new Date()
  const week = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setDate(today.getDate() - (6 - index))
    return getDailyData(formatDate(date))
  })

  response.json(week)
})

app.use((error, _request, response, _next) => {
  if (error.message === "Origin is not allowed by CORS") {
    response.status(403).json({ error: error.message })
    return
  }
  response.status(500).json({ error: "Internal server error." })
})

app.listen(port, () => {
  console.log(`Wearable API listening on http://localhost:${port}`)
})
