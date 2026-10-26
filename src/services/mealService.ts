import { fetchWithAuth } from "./authService"

export type MealType = "breakfast" | "lunch" | "dinner" | "snack"

export type MealRecord = {
  id: string
  userId: string
  mealType: MealType
  foodName: string
  portionSize: string
  calories: number
  protein: number
  carbs: number
  fat: number
  notes: string
  loggedAt: string
  photoUrl: string | null
}

export type CreateMealInput = {
  mealType: MealType
  foodName: string
  portionSize: string
  calories: number
  protein: number
  carbs: number
  fat: number
  notes: string
  photo?: File | null
}

export type Patient = {
  id: string
  name: string
  email: string
}

export type PatientSummary = {
  patient: { id: string; name: string }
  today: { calories: number; protein: number; carbs: number; fat: number }
  lastSevenDays: Array<{ date: string; calories: number }>
}

const apiBaseUrl = (
  import.meta.env.VITE_WEARABLE_API_BASE_URL || "http://localhost:3001"
).replace(/\/+$/, "")

async function parseResponse<T>(response: Response): Promise<T> {
  let result: unknown
  try {
    result = await response.json()
  } catch {
    throw new Error("The meals service returned an unreadable response.")
  }
  if (!response.ok) {
    if (
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
    ) {
      throw new Error(result.error)
    }
    throw new Error(`Meals request failed (${response.status}).`)
  }
  return result as T
}

export async function createMeal(input: CreateMealInput): Promise<MealRecord> {
  const body = new FormData()
  body.set("mealType", input.mealType)
  body.set("foodName", input.foodName)
  body.set("portionSize", input.portionSize)
  body.set("calories", String(input.calories))
  body.set("protein", String(input.protein))
  body.set("carbs", String(input.carbs))
  body.set("fat", String(input.fat))
  body.set("notes", input.notes)
  if (input.photo) body.set("photo", input.photo)

  const response = await fetchWithAuth(`${apiBaseUrl}/api/meals`, {
    method: "POST",
    body,
  })
  const result = await parseResponse<{ meal: MealRecord }>(response)
  return result.meal
}

export async function fetchMyMeals(): Promise<MealRecord[]> {
  const response = await fetchWithAuth(`${apiBaseUrl}/api/meals`)
  const result = await parseResponse<{ meals: MealRecord[] }>(response)
  return result.meals
}

export async function fetchPatients(): Promise<Patient[]> {
  const response = await fetchWithAuth(`${apiBaseUrl}/api/patients`)
  const result = await parseResponse<{ patients: Patient[] }>(response)
  return result.patients
}

export async function fetchPatientMeals(patientId: string): Promise<MealRecord[]> {
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/patients/${encodeURIComponent(patientId)}/meals`,
  )
  const result = await parseResponse<{ meals: MealRecord[] }>(response)
  return result.meals
}

export async function fetchPatientSummary(patientId: string): Promise<PatientSummary> {
  const response = await fetchWithAuth(
    `${apiBaseUrl}/api/patients/${encodeURIComponent(patientId)}/summary`,
  )
  return parseResponse<PatientSummary>(response)
}

export async function fetchMealPhoto(photoUrl: string): Promise<string> {
  const url = photoUrl.startsWith("http") ? photoUrl : `${apiBaseUrl}${photoUrl}`
  const response = await fetchWithAuth(url)
  if (!response.ok) {
    let message = `Could not load meal photo (${response.status}).`
    try {
      const body = await response.json() as { error?: string }
      if (body.error) message = body.error
    } catch {
      // Keep the HTTP status message when the server response is not JSON.
    }
    throw new Error(message)
  }
  return URL.createObjectURL(await response.blob())
}
