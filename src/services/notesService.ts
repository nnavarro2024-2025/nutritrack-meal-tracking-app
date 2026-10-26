import { fetchWithAuth } from "./authService"

export type AssessmentDomain =
  | "food/nutrition-related history"
  | "anthropometric measurements"
  | "biochemical data and medical tests"
  | "nutrition-focused physical findings"
  | "client history"

export type NotesTerminology = {
  assessmentDomain: AssessmentDomain[]
  assessmentMonitoringTerm: string[]
  assessmentDomainByTerm: Record<string, AssessmentDomain>
  diagnosisTerm: string[]
  diagnosisCodeByTerm: Record<string, string>
  interventionCategory: string[]
  interventionTerm: string[]
  interventionCategoryByTerm: Record<string, string>
  monitoringStatus: string[]
}

export type AssessmentItem = {
  domain: AssessmentDomain
  term: string
  code?: string
  value: string | number
  unit: string
}

export type ClinicalNote = {
  patientId: string
  providerId: string
  date: string
  assessment: {
    domains: Array<{
      domain: AssessmentDomain
      items: Array<Pick<AssessmentItem, "term" | "value" | "unit"> & Partial<Pick<AssessmentItem, "code">>>
    }>
  }
  diagnosis: {
    problem: { term: string; code?: string }
    etiology: string
    signsSymptoms: string[]
    generatedSentence: string
  }
  intervention: {
    category: string
    term: string
    goal: string
    schedule: { frequency: string; startDate: string }
  }
  monitoringEvaluation: {
    indicator: string
    target: string | number
    measuredResult: string | number
    status: string
  }
}

export type NoteValidationError = {
  path: string
  message: string
}

export class NoteValidationFailure extends Error {
  errors: NoteValidationError[]

  constructor(errors: NoteValidationError[]) {
    super("The clinical note needs corrections.")
    this.name = "NoteValidationFailure"
    this.errors = errors
  }
}

const apiBaseUrl = (
  import.meta.env.VITE_WEARABLE_API_BASE_URL || "http://localhost:3001"
).replace(/\/+$/, "")

async function parseResponse(response: Response): Promise<unknown> {
  const result: unknown = await response.json()
  if (!response.ok) {
    if (
      typeof result === "object" &&
      result !== null &&
      "errors" in result &&
      Array.isArray(result.errors)
    ) {
      throw new NoteValidationFailure(result.errors as NoteValidationError[])
    }
    if (
      typeof result === "object" &&
      result !== null &&
      "error" in result &&
      typeof result.error === "string"
    ) {
      throw new Error(result.error)
    }
    throw new Error(`Notes API request failed (${response.status}).`)
  }
  return result
}

function isNotesTerminology(value: unknown): value is NotesTerminology {
  if (typeof value !== "object" || value === null) return false
  const lists = value as Record<string, unknown>
  const keys: Array<keyof NotesTerminology> = [
    "assessmentDomain",
    "assessmentMonitoringTerm",
    "diagnosisTerm",
    "interventionCategory",
    "interventionTerm",
    "monitoringStatus",
  ]
  const validLists = keys.every(
    (key) => Array.isArray(lists[key]) && lists[key].every((item) => typeof item === "string"),
  )
  const isStringMap = (key: string) =>
    typeof lists[key] === "object" &&
    lists[key] !== null &&
    Object.values(lists[key]).every((item) => typeof item === "string")
  return validLists &&
    isStringMap("assessmentDomainByTerm") &&
    isStringMap("diagnosisCodeByTerm") &&
    isStringMap("interventionCategoryByTerm")
}

export async function fetchNotesTerminology(): Promise<NotesTerminology> {
  const response = await fetch(`${apiBaseUrl}/api/terminology`)
  const result = await parseResponse(response)
  if (!isNotesTerminology(result)) {
    throw new Error("The terminology service returned invalid term lists.")
  }
  return result
}

export async function validateClinicalNote(note: ClinicalNote): Promise<void> {
  const response = await fetchWithAuth(`${apiBaseUrl}/api/notes/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(note),
  })
  const result = await parseResponse(response)
  if (
    typeof result !== "object" ||
    result === null ||
    !("valid" in result) ||
    result.valid !== true
  ) {
    throw new Error("The notes service returned an unexpected validation response.")
  }
}
