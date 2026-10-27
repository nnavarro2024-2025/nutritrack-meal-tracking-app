export type WearableDailyData = {
  date: string
  steps: number
  activeEnergyKcal: number
  distanceKm: number
  lastSynced: string
}

export type WearableSource = "googlefit" | "applehealth"

export type GoogleFitDailyResponse = {
  source: "googlefit"
  date: string
  step_count: number
  calories_expended: number
  distance_meters: number
  synced_at: string
}

export type AppleHealthDailyResponse = {
  source: "applehealth"
  date: string
  stepCount: number
  activeEnergyBurned: { value: number; unit: "kcal" }
  distanceWalkingRunning: { value: number; unit: "km" }
  endDate: string
}

const apiBaseUrl = (import.meta.env.VITE_WEARABLE_API_BASE_URL || "http://localhost:3001").replace(/\/+$/, "")
const selectedSourceKey = "nutritrack.wearable.selectedSource"
const syncedSourceKey = "nutritrack.wearable.lastSyncedSource"

function isWearableSource(value: string | null): value is WearableSource {
  return value === "googlefit" || value === "applehealth"
}

export function getSelectedWearableSource(): WearableSource {
  const saved = localStorage.getItem(selectedSourceKey)
  return isWearableSource(saved) ? saved : "googlefit"
}

export function rememberSelectedWearableSource(source: WearableSource): void {
  localStorage.setItem(selectedSourceKey, source)
}

export function getLastSyncedWearableSource(): WearableSource {
  const saved = localStorage.getItem(syncedSourceKey)
  return isWearableSource(saved) ? saved : "googlefit"
}

export function rememberSyncedWearableSource(source: WearableSource): void {
  localStorage.setItem(selectedSourceKey, source)
  localStorage.setItem(syncedSourceKey, source)
}

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

function isGoogleFitDailyResponse(value: unknown): value is GoogleFitDailyResponse {
  if (typeof value !== "object" || value === null) return false
  const data = value as Record<string, unknown>
  return data.source === "googlefit" &&
    typeof data.date === "string" &&
    typeof data.step_count === "number" &&
    typeof data.calories_expended === "number" &&
    typeof data.distance_meters === "number" &&
    typeof data.synced_at === "string"
}

function isAppleHealthDailyResponse(value: unknown): value is AppleHealthDailyResponse {
  if (typeof value !== "object" || value === null) return false
  const data = value as Record<string, unknown>
  if (
    data.source !== "applehealth" ||
    typeof data.date !== "string" ||
    typeof data.stepCount !== "number" ||
    typeof data.endDate !== "string" ||
    typeof data.activeEnergyBurned !== "object" ||
    data.activeEnergyBurned === null ||
    typeof data.distanceWalkingRunning !== "object" ||
    data.distanceWalkingRunning === null
  ) return false
  const energy = data.activeEnergyBurned as Record<string, unknown>
  const distance = data.distanceWalkingRunning as Record<string, unknown>
  return typeof energy.value === "number" &&
    energy.unit === "kcal" &&
    typeof distance.value === "number" &&
    distance.unit === "km"
}

export function normalizeGoogleFitData(data: GoogleFitDailyResponse): WearableDailyData {
  return {
    date: data.date,
    steps: data.step_count,
    activeEnergyKcal: data.calories_expended,
    distanceKm: data.distance_meters / 1000,
    lastSynced: data.synced_at,
  }
}

export function normalizeAppleHealthData(data: AppleHealthDailyResponse): WearableDailyData {
  return {
    date: data.date,
    steps: data.stepCount,
    activeEnergyKcal: data.activeEnergyBurned.value,
    distanceKm: data.distanceWalkingRunning.value,
    lastSynced: data.endDate,
  }
}

function normalizeSourceResponse(value: unknown, source: WearableSource): WearableDailyData {
  if (source === "googlefit" && isGoogleFitDailyResponse(value)) return normalizeGoogleFitData(value)
  if (source === "applehealth" && isAppleHealthDailyResponse(value)) return normalizeAppleHealthData(value)
  throw new Error("Wearable API returned an invalid source-specific response.")
}

export async function fetchDailyWearableData(
  date = getLocalDate(),
  source?: WearableSource,
): Promise<WearableDailyData> {
  const query = new URLSearchParams({ date })
  if (source) query.set("source", source)
  const response = await fetch(`${apiBaseUrl}/api/wearable/daily?${query}`)
  const body = await readResponse(response)
  if (source) return normalizeSourceResponse(body, source)
  if (!isWearableDailyData(body)) {
    throw new Error("Wearable API returned an invalid daily data response.")
  }
  return body
}

export async function fetchWeeklyWearableData(source?: WearableSource): Promise<WearableDailyData[]> {
  const query = source ? `?${new URLSearchParams({ source })}` : ""
  const response = await fetch(`${apiBaseUrl}/api/wearable/week${query}`)
  const body = await readResponse(response)
  if (!Array.isArray(body) || body.length !== 7) {
    throw new Error("Wearable API returned an invalid weekly data response.")
  }
  if (source) return body.map((item) => normalizeSourceResponse(item, source))
  if (!body.every(isWearableDailyData)) {
    throw new Error("Wearable API returned an invalid weekly data response.")
  }
  return body
}
