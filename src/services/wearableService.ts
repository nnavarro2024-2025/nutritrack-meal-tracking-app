export type WearableDailyData = {
  date: string
  steps: number
  activeEnergyKcal: number
  distanceKm: number
  lastSynced: string
}

const apiBaseUrl = (import.meta.env.VITE_WEARABLE_API_BASE_URL || "http://localhost:3001").replace(/\/+$/, "")

function getLocalDate() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

async function readResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json()
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Wearable API request failed (${response.status}).`
    throw new Error(message)
  }
  return body
}

function isWearableDailyData(value: unknown): value is WearableDailyData {
  if (typeof value !== "object" || value === null) return false
  const data = value as Record<string, unknown>
  return (
    typeof data.date === "string" &&
    typeof data.steps === "number" &&
    typeof data.activeEnergyKcal === "number" &&
    typeof data.distanceKm === "number" &&
    typeof data.lastSynced === "string"
  )
}

export async function fetchDailyWearableData(date = getLocalDate()): Promise<WearableDailyData> {
  const query = new URLSearchParams({ date })
  const response = await fetch(`${apiBaseUrl}/api/wearable/daily?${query}`)
  const body = await readResponse(response)
  if (!isWearableDailyData(body)) {
    throw new Error("Wearable API returned an invalid daily data response.")
  }
  return body
}

export async function fetchWeeklyWearableData(): Promise<WearableDailyData[]> {
  const response = await fetch(`${apiBaseUrl}/api/wearable/week`)
  const body = await readResponse(response)
  if (!Array.isArray(body) || body.length !== 7 || !body.every(isWearableDailyData)) {
    throw new Error("Wearable API returned an invalid weekly data response.")
  }
  return body
}
