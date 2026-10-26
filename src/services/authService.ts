export type UserRole = "consumer" | "dietitian"

export type AuthUser = {
  id: string
  name: string
  role: UserRole
}

export type AuthSession = {
  token: string
  user: AuthUser
}

type ApiErrorBody = {
  error?: string
  code?: string
}

export class AuthApiError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "AuthApiError"
    this.status = status
    this.code = code
  }
}

const apiBaseUrl = (
  import.meta.env.VITE_WEARABLE_API_BASE_URL || "http://localhost:3001"
).replace(/\/+$/, "")
const tokenKey = "nutritrack.auth.token"

export function getAuthToken(): string | null {
  return localStorage.getItem(tokenKey)
}

export function clearAuthToken(): void {
  localStorage.removeItem(tokenKey)
}

function saveSession(session: AuthSession): AuthUser {
  localStorage.setItem(tokenKey, session.token)
  return session.user
}

async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    throw new AuthApiError("The authentication service returned an unreadable response.", response.status)
  }
}

function readApiError(value: unknown, status: number): AuthApiError {
  if (typeof value === "object" && value !== null) {
    const body = value as ApiErrorBody
    if (typeof body.error === "string") return new AuthApiError(body.error, status, body.code)
  }
  return new AuthApiError(`Authentication failed (${status}).`, status)
}

function isAuthSession(value: unknown): value is AuthSession {
  if (typeof value !== "object" || value === null) return false
  const body = value as Partial<AuthSession>
  return typeof body.token === "string" &&
    typeof body.user === "object" &&
    body.user !== null &&
    typeof body.user.id === "string" &&
    typeof body.user.name === "string" &&
    (body.user.role === "consumer" || body.user.role === "dietitian")
}

function isAuthUser(value: unknown): value is AuthUser {
  if (typeof value !== "object" || value === null) return false
  const user = value as Partial<AuthUser>
  return typeof user.id === "string" &&
    typeof user.name === "string" &&
    (user.role === "consumer" || user.role === "dietitian")
}

async function postCredentials(path: "register" | "login", body: Record<string, string>): Promise<AuthUser> {
  const response = await fetch(`${apiBaseUrl}/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const result = await parseJson(response)
  if (!response.ok) throw readApiError(result, response.status)
  if (!isAuthSession(result)) {
    throw new AuthApiError("The authentication service returned an invalid session.", response.status)
  }
  return saveSession(result)
}

export function register(
  values: { name: string; email: string; password: string; role: UserRole },
): Promise<AuthUser> {
  return postCredentials("register", values)
}

export function login(email: string, password: string): Promise<AuthUser> {
  return postCredentials("login", { email, password })
}

export async function fetchCurrentUser(): Promise<AuthUser> {
  const response = await fetchWithAuth(`${apiBaseUrl}/api/auth/me`)
  const result = await parseJson(response)
  if (!response.ok) throw readApiError(result, response.status)
  if (
    typeof result !== "object" ||
    result === null ||
    !("user" in result) ||
    !isAuthUser(result.user)
  ) {
    throw new AuthApiError("The authentication service returned an invalid user.", response.status)
  }
  return result.user
}

export async function fetchWithAuth(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = getAuthToken()
  const headers = new Headers(init.headers)
  if (token) headers.set("Authorization", `Bearer ${token}`)
  const response = await fetch(input, { ...init, headers })
  if (response.status === 401 && token) {
    let error: ApiErrorBody = {}
    try {
      error = await response.clone().json() as ApiErrorBody
    } catch {
      error = {}
    }
    clearAuthToken()
    window.dispatchEvent(new CustomEvent("nutritrack:session-expired", { detail: error }))
  }
  return response
}
