import { FormEvent, ReactNode, useEffect, useState } from "react"
import { todaySummary } from "./data/mockData"
import Charting from "./components/Charting"
import ClinicalNoteView from "./components/ClinicalNoteView"
import {
  fetchDailyWearableData,
  fetchWeeklyWearableData,
  getLastSyncedWearableSource,
  getSelectedWearableSource,
  rememberSelectedWearableSource,
  rememberSyncedWearableSource,
  WearableDailyData,
  WearableSource,
} from "./services/wearableService"
import {
  CreateMealInput,
  MealRecord,
  Patient,
  PatientSummary,
  createMeal,
  fetchMealPhoto,
  fetchMyMeals,
  fetchPatientMeals,
  fetchPatientSummary,
  fetchPatients,
} from "./services/mealService"
import {
  DietaryPolicy,
  PolicyCheckResult,
  PolicyMissingDataError,
  fetchDietaryPolicies,
  runPatientPolicyCheck,
} from "./services/policyService"
import {
  SavedClinicalNote,
  fetchMyNotes,
  fetchPatientNotes,
  fetchSavedNote,
} from "./services/notesService"
import {
  AuthApiError,
  AuthUser,
  UserRole,
  clearAuthToken,
  fetchCurrentUser,
  getAuthToken,
  login as loginUser,
  register as registerUser,
} from "./services/authService"

type Tab = "home" | "log" | "history" | "wearable" | "careplan" | "patients" | "charting"
type ViewState = "ready" | "loading" | "empty" | "error"

const Icon = ({ name, size = 22 }: { name: string; size?: number }) => {
  const paths: Record<string, ReactNode> = {
    home: <><path d="M3 11.5 12 4l9 7.5" /><path d="M5.5 10v10h13V10M9 20v-6h6v6" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    list: <><path d="M8 6h13M8 12h13M8 18h13" /><path d="M3 6h.01M3 12h.01M3 18h.01" /></>,
    watch: <><rect x="7" y="5" width="10" height="14" rx="3" /><path d="m9 5 1-3h4l1 3m-6 14 1 3h4l1-3" /></>,
    flame: <path d="M13 2s1 4-2 7c-2-2-3-3-3-3s-4 4-4 9a8 8 0 0 0 16 0c0-4-3-7-3-7s0 3-2 5c0-5-2-11-2-11Z" />,
    steps: <><path d="M7 13c-2 0-4 2-4 4s2 3 4 3 3-1 3-3-1-4-3-4Zm10-9c-2 0-3 2-3 4s1 3 3 3 4-1 4-3-2-4-4-4Z" /></>,
    camera: <><path d="M4 7h3l2-2h6l2 2h3v12H4Z" /><circle cx="12" cy="13" r="3" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21c1-5 4-7 8-7s7 2 8 7" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    chart: <><path d="M4 19V5" /><path d="M4 19h17" /><path d="m7 15 4-4 3 2 5-6" /></>,
    arrow: <path d="m9 18 6-6-6-6" />,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function StatePicker({ value, onChange }: { value: ViewState; onChange: (v: ViewState) => void }) {
  return (
    <select className="state-picker" value={value} onChange={(e) => onChange(e.target.value as ViewState)} aria-label="Preview screen state">
      <option value="ready">Ready state</option>
      <option value="loading">Loading state</option>
      <option value="empty">Empty state</option>
      <option value="error">Error state</option>
    </select>
  )
}

function StatusState({ type, onRetry }: { type: Exclude<ViewState, "ready">; onRetry: () => void }) {
  if (type === "loading") return <div className="skeleton-wrap"><div className="skeleton wide" /><div className="skeleton-grid"><div className="skeleton card" /><div className="skeleton card" /></div></div>
  const isError = type === "error"
  return (
    <div className="status-card">
      <div className={`status-icon ${isError ? "error" : ""}`}><Icon name={isError ? "arrow" : "heart"} size={25} /></div>
      <h3>{isError ? "Something went off track" : "Nothing here yet"}</h3>
      <p>{isError ? "We couldn’t load your data. Check your connection and try again." : "Your health data will appear here once you start tracking."}</p>
      <button className="secondary-button" onClick={onRetry}>{isError ? "Try again" : "Show sample data"}</button>
    </div>
  )
}

function ProgressRing({ value, goal, color, label }: { value: number; goal: number; color: string; label: string }) {
  const pct = Math.min(100, Math.round((value / goal) * 100))
  return (
    <div className="ring-item">
      <div className="ring" style={{ "--pct": `${pct * 3.6}deg`, "--ring-color": color } as React.CSSProperties}>
        <strong>{pct}%</strong>
      </div>
      <span>{label}</span>
      <small>{value} / {goal}g</small>
    </div>
  )
}

function isToday(value: string) {
  const date = new Date(value)
  const today = new Date()
  return date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
}

function Dashboard({ goToLog, userName }: { goToLog: () => void; userName: string }) {
  const [state, setState] = useState<ViewState>("loading")
  const [wearableData, setWearableData] = useState<WearableDailyData | null>(null)
  const [wearableSource] = useState<WearableSource>(() => getLastSyncedWearableSource())
  const [meals, setMeals] = useState<MealRecord[]>([])
  const [mealState, setMealState] = useState<ViewState>("loading")
  const [mealRefresh, setMealRefresh] = useState(0)
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    let active = true
    setState("loading")
    fetchDailyWearableData(undefined, wearableSource)
      .then((data) => {
        if (active) {
          setWearableData(data)
          setState("ready")
        }
      })
      .catch(() => {
        if (active) setState("error")
      })
    return () => { active = false }
  }, [refreshKey, wearableSource])
  useEffect(() => {
    let active = true
    setMealState("loading")
    fetchMyMeals()
      .then((result) => {
        if (active) {
          setMeals(result)
          setMealState(result.length ? "ready" : "empty")
        }
      })
      .catch(() => {
        if (active) setMealState("error")
      })
    return () => { active = false }
  }, [mealRefresh])
  const retry = () => {
    setState("loading")
    setRefreshKey((key) => key + 1)
  }
  if (!wearableData) {
    const unavailableState = state === "ready" ? "error" : state
    const updateState = (nextState: ViewState) => {
      if (nextState === "ready") {
        retry()
      } else {
        setState(nextState)
      }
    }
    return <Screen title="Today" action={<StatePicker value={state} onChange={updateState} />}><StatusState type={unavailableState} onRetry={retry} /></Screen>
  }
  if (state !== "ready") return <Screen title="Today" action={<StatePicker value={state} onChange={setState} />}><StatusState type={state} onRetry={retry} /></Screen>
  const todayMeals = meals.filter((meal) => isToday(meal.loggedAt))
  const totals = todayMeals.reduce((result, meal) => ({
    calories: result.calories + meal.calories,
    protein: result.protein + meal.protein,
    carbs: result.carbs + meal.carbs,
    fat: result.fat + meal.fat,
  }), { calories: 0, protein: 0, carbs: 0, fat: 0 })
  const calPct = Math.round((totals.calories / todaySummary.calories.goal) * 100)
  return (
    <Screen title={`Good morning, ${userName.split(" ")[0]}`} eyebrow={new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })} action={<StatePicker value={state} onChange={setState} />}>
      <section className="calorie-card">
        <div><span className="section-kicker">TODAY’S ENERGY</span>{mealState === "loading" ? <div className="skeleton wide" /> : mealState === "error" ? <p role="alert">Couldn’t load today’s meals. <button className="inline-retry" onClick={() => setMealRefresh((value) => value + 1)}>Try again</button></p> : <><div className="calorie-number">{totals.calories.toLocaleString()}</div><p>of {todaySummary.calories.goal.toLocaleString()} kcal</p>{mealState === "empty" || todayMeals.length === 0 ? <small>No meals logged today yet.</small> : null}</>}</div>
        <div className="calorie-gauge" style={{ "--pct": `${calPct * 3.6}deg` } as React.CSSProperties}><div><strong>{Math.max(0, todaySummary.calories.goal - totals.calories)}</strong><small>left</small></div></div>
      </section>
      <section className="card">
        <div className="section-heading"><div><span className="section-kicker">DAILY BALANCE</span><h2>Macronutrients</h2></div><span className="fresh-pill">On track</span></div>
        {mealState === "loading" ? <div className="skeleton wide" /> : <div className="rings">{todaySummary.macros.map((macro) => <ProgressRing key={macro.label} {...macro} value={totals[macro.label.toLowerCase() as "protein" | "carbs" | "fat"]} />)}</div>}
      </section>
      <div className="metric-grid">
        <section className="metric-card"><div className="metric-icon mint"><Icon name="steps" /></div><span>Steps</span><strong>{wearableData.steps.toLocaleString()}</strong><small>of {todaySummary.stepGoal.toLocaleString()}</small><div className="progress"><i style={{ width: `${Math.min(100, wearableData.steps / 100)}%` }} /></div></section>
        <section className="metric-card"><div className="metric-icon peach"><Icon name="flame" /></div><span>Active energy</span><strong>{wearableData.activeEnergyKcal}</strong><small>kcal burned</small><div className="progress peach-bar"><i style={{ width: `${Math.min(100, Math.round((wearableData.activeEnergyKcal / 900) * 100))}%` }} /></div></section>
      </div>
      <button className="primary-button quick-add" onClick={goToLog}><Icon name="plus" /> Log a meal</button>
    </Screen>
  )
}

const fields = ["food", "portion", "calories", "protein", "carbs", "fat"] as const
type OptionalNutrientField = "sodiumMg" | "fiberG" | "addedSugarG"
type MealForm = Record<(typeof fields)[number], string> &
  Record<OptionalNutrientField, string> & { type: string; notes: string }

function MealLog({ onSave }: { onSave: (meal: CreateMealInput) => Promise<void> }) {
  const blank: MealForm = { type: "breakfast", food: "", portion: "", calories: "", protein: "", carbs: "", fat: "", sodiumMg: "", fiberG: "", addedSugarG: "", notes: "" }
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState<Partial<Record<keyof MealForm, string>>>({})
  const [preview, setPreview] = useState("")
  const [photo, setPhoto] = useState<File | null>(null)
  const [formError, setFormError] = useState("")
  const [busy, setBusy] = useState(false)
  const update = (key: keyof MealForm, value: string) => setForm((old) => ({ ...old, [key]: value }))
  useEffect(() => () => { if (preview.startsWith("blob:")) URL.revokeObjectURL(preview) }, [preview])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    fields.forEach((key) => { if (!form[key].trim()) next[key] = "This field is required" })
    fields.slice(2).forEach((key) => {
      if (!Number.isFinite(Number(form[key])) || Number(form[key]) < 0) next[key] = "Enter a valid non-negative amount"
    })
    for (const key of ["sodiumMg", "fiberG", "addedSugarG"] as const) {
      if (form[key].trim() && (!Number.isFinite(Number(form[key])) || Number(form[key]) < 0)) {
        next[key] = "Enter a valid non-negative amount or leave it blank"
      }
    }
    setErrors(next)
    setFormError("")
    if (Object.keys(next).length) return
    setBusy(true)
    try {
      await onSave({
        mealType: form.type as CreateMealInput["mealType"],
        foodName: form.food.trim(),
        portionSize: form.portion.trim(),
        calories: Number(form.calories),
        protein: Number(form.protein),
        carbs: Number(form.carbs),
        fat: Number(form.fat),
        ...(form.sodiumMg.trim() ? { sodiumMg: Number(form.sodiumMg) } : {}),
        ...(form.fiberG.trim() ? { fiberG: Number(form.fiberG) } : {}),
        ...(form.addedSugarG.trim() ? { addedSugarG: Number(form.addedSugarG) } : {}),
        notes: form.notes.trim(),
        photo,
      })
      setForm(blank)
      setPhoto(null)
      setPreview("")
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Meal could not be saved. Please try again.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Screen title="Log a meal" eyebrow="Add what you ate">
      {formError && <div className="auth-message" role="alert">{formError}</div>}
      <form className="meal-form" onSubmit={(event) => { void submit(event) }} noValidate>
        <section className="card form-card">
          <div className="field"><label htmlFor="mealType">Meal type</label><select id="mealType" value={form.type} onChange={(e) => update("type", e.target.value)}><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option></select></div>
          <TextField label="Food name" name="food" placeholder="e.g. Grilled chicken salad" form={form} update={update} error={errors.food} />
          <div className="form-row"><TextField label="Portion size" name="portion" placeholder="e.g. 1 bowl" form={form} update={update} error={errors.portion} /><TextField label="Calories" name="calories" placeholder="0" type="number" form={form} update={update} error={errors.calories} /></div>
          <div className="form-row three"><TextField label="Protein (g)" name="protein" placeholder="0" type="number" form={form} update={update} error={errors.protein} /><TextField label="Carbs (g)" name="carbs" placeholder="0" type="number" form={form} update={update} error={errors.carbs} /><TextField label="Fat (g)" name="fat" placeholder="0" type="number" form={form} update={update} error={errors.fat} /></div>
          <div className="form-row three">
            <TextField label="Sodium (mg)" name="sodiumMg" placeholder="Optional" type="number" form={form} update={update} error={errors.sodiumMg} optional />
            <TextField label="Fiber (g)" name="fiberG" placeholder="Optional" type="number" form={form} update={update} error={errors.fiberG} optional />
            <TextField label="Added sugar (g)" name="addedSugarG" placeholder="Optional" type="number" form={form} update={update} error={errors.addedSugarG} optional />
          </div>
          <div className="field"><label htmlFor="notes">Notes <span>Optional</span></label><textarea id="notes" rows={3} placeholder="How did it make you feel?" value={form.notes} onChange={(e) => update("notes", e.target.value)} /></div>
          <label className="photo-upload">
            {preview ? <img src={preview} alt="Meal preview" /> : <><div className="upload-icon"><Icon name="camera" /></div><strong>Add a meal photo</strong><span>PNG or JPG, up to 5MB</span></>}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => {
              const file = e.target.files?.[0]
              if (!file) return
              setFormError("")
              if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
                setFormError("Choose a JPG, PNG, or WEBP photo.")
                return
              }
              if (file.size > 5 * 1024 * 1024) {
                setFormError("Photo must be 5 MB or smaller.")
                return
              }
              setPhoto(file)
              setPreview(URL.createObjectURL(file))
            }} />
          </label>
        </section>
        <button className="primary-button" type="submit" disabled={busy}>{busy ? "Saving…" : "Save meal"} <Icon name="arrow" /></button>
      </form>
    </Screen>
  )
}

function TextField({ label, name, placeholder, type = "text", form, update, error, optional = false }: { label: string; name: keyof MealForm; placeholder: string; type?: string; form: MealForm; update: (k: keyof MealForm, v: string) => void; error?: string; optional?: boolean }) {
  return <div className={`field ${error ? "has-error" : ""}`}><label htmlFor={name}>{label}{optional && <span>Optional</span>}</label><input id={name} type={type} min="0" placeholder={placeholder} value={form[name]} onChange={(e) => update(name, e.target.value)} />{error && <span className="field-error">{error}</span>}</div>
}

function mealPolicyNutrients(meal: MealRecord) {
  return [
    meal.sodiumMg !== undefined ? `Sodium ${meal.sodiumMg} mg` : "",
    meal.fiberG !== undefined ? `Fiber ${meal.fiberG} g` : "",
    meal.addedSugarG !== undefined ? `Added sugar ${meal.addedSugarG} g` : "",
  ].filter(Boolean).join(" · ")
}

function MealPhoto({ meal }: { meal: MealRecord }) {
  const [photoUrl, setPhotoUrl] = useState("")
  useEffect(() => {
    let active = true
    let objectUrl = ""
    if (meal.photoUrl) {
      void fetchMealPhoto(meal.photoUrl).then((url) => {
        objectUrl = url
        if (active) setPhotoUrl(url)
        else URL.revokeObjectURL(url)
      }).catch(() => {
        if (active) setPhotoUrl("")
      })
    } else {
      setPhotoUrl("")
    }
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [meal.photoUrl])
  return photoUrl ? <img src={photoUrl} alt={`${meal.foodName}`} /> : <div className="meal-placeholder"><Icon name="camera" /></div>
}

function mealDisplayTime(meal: MealRecord) {
  const date = new Date(meal.loggedAt)
  return isToday(meal.loggedAt)
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function History() {
  const [previewState, setPreviewState] = useState<ViewState>("ready")
  const [dataState, setDataState] = useState<ViewState>("loading")
  const [meals, setMeals] = useState<MealRecord[]>([])
  const [retryKey, setRetryKey] = useState(0)
  useEffect(() => {
    let active = true
    setDataState("loading")
    fetchMyMeals().then((result) => {
      if (active) {
        setMeals(result)
        setDataState(result.length ? "ready" : "empty")
      }
    }).catch(() => {
      if (active) setDataState("error")
    })
    return () => { active = false }
  }, [retryKey])
  const state = previewState === "ready" ? dataState : previewState
  const retry = () => {
    setPreviewState("ready")
    setRetryKey((key) => key + 1)
  }
  return (
    <Screen title="Meal history" eyebrow="Your recent meals" action={<StatePicker value={previewState} onChange={setPreviewState} />}>
      {state !== "ready" ? <StatusState type={state} onRetry={retry} /> : <div className="history-list">
        <div className="history-date"><span>All meals</span><small>{meals.length} meals</small></div>
        {meals.map((meal) => <article className="meal-card" key={meal.id}><MealPhoto meal={meal} /><div className="meal-copy"><div><span className="meal-type">{meal.mealType}</span><small>{mealDisplayTime(meal)}</small></div><h3>{meal.foodName}</h3><p>{meal.portionSize} · {meal.protein}g P · {meal.carbs}g C · {meal.fat}g F</p>{mealPolicyNutrients(meal) && <p>{mealPolicyNutrients(meal)}</p>}{meal.notes && <p>{meal.notes}</p>}</div><strong className="meal-cal">{meal.calories}<small>kcal</small></strong></article>)}
      </div>}
    </Screen>
  )
}

function PatientsPage({ provider }: { provider: AuthUser }) {
  const [patients, setPatients] = useState<Patient[]>([])
  const [state, setState] = useState<ViewState>("loading")
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const [charting, setCharting] = useState(false)
  const [notesRefreshKey, setNotesRefreshKey] = useState(0)
  const [savedNotice, setSavedNotice] = useState("")

  useEffect(() => {
    let active = true
    setState("loading")
    fetchPatients().then((result) => {
      if (!active) return
      setPatients(result)
      setState(result.length ? "ready" : "empty")
    }).catch(() => {
      if (active) setState("error")
    })
    return () => { active = false }
  }, [retryKey])

  if (charting && selectedPatient) {
    return (
      <Charting
        key={`${selectedPatient.id}-${provider.id}`}
        patient={selectedPatient}
        provider={provider}
        onBack={() => setCharting(false)}
        onSaved={() => {
          setCharting(false)
          setNotesRefreshKey((key) => key + 1)
          setSavedNotice("Clinical note saved successfully.")
        }}
      />
    )
  }

  if (selectedPatient) {
    return (
      <PatientDetails
        key={`${selectedPatient.id}-${notesRefreshKey}`}
        patient={selectedPatient}
        onBack={() => { setSelectedPatient(null); setSavedNotice("") }}
        onStartChart={() => { setSavedNotice(""); setCharting(true) }}
        refreshKey={notesRefreshKey}
        savedNotice={savedNotice}
        providerName={provider.name}
      />
    )
  }

  return (
    <Screen title="Patients" eyebrow="Dietitian workspace">
      {state === "loading" || state === "error"
        ? <StatusState type={state} onRetry={() => setRetryKey((key) => key + 1)} />
        : state === "empty"
          ? <section className="status-card"><div className="status-icon"><Icon name="user" size={25} /></div><h3>No assigned patients yet</h3><p>Consumers assigned to you will appear here.</p></section>
          : <div className="patient-list">
            {patients.map((patient) => (
              <button className="patient-row card" key={patient.id} onClick={() => setSelectedPatient(patient)}>
                <span className="avatar"><Icon name="user" /></span>
                <span className="patient-row-copy"><strong>{patient.name}</strong><small>{patient.email}</small></span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>}
    </Screen>
  )
}

function PatientDetails({
  patient,
  onBack,
  onStartChart,
  refreshKey,
  savedNotice,
  providerName,
}: {
  patient: Patient
  onBack: () => void
  onStartChart: () => void
  refreshKey: number
  savedNotice: string
  providerName: string
}) {
  const [summary, setSummary] = useState<PatientSummary | null>(null)
  const [meals, setMeals] = useState<MealRecord[]>([])
  const [notes, setNotes] = useState<SavedClinicalNote[]>([])
  const [state, setState] = useState<ViewState>("loading")
  const [retryKey, setRetryKey] = useState(0)
  const [selectedNote, setSelectedNote] = useState<SavedClinicalNote | null>(null)
  const [noteState, setNoteState] = useState<"ready" | "loading" | "error">("ready")
  const [noteError, setNoteError] = useState("")

  useEffect(() => {
    let active = true
    setState("loading")
    Promise.all([fetchPatientSummary(patient.id), fetchPatientMeals(patient.id), fetchPatientNotes(patient.id)])
      .then(([patientSummary, patientMeals, patientNotes]) => {
        if (!active) return
        setSummary(patientSummary)
        setMeals(patientMeals)
        setNotes(patientNotes)
        setState("ready")
      })
      .catch(() => {
        if (active) setState("error")
      })
    return () => { active = false }
  }, [patient.id, refreshKey, retryKey])

  const openNote = async (noteId: string) => {
    setNoteState("loading")
    setNoteError("")
    try {
      setSelectedNote(await fetchSavedNote(noteId))
      setNoteState("ready")
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Could not load this clinical note.")
      setNoteState("error")
    }
  }

  if (selectedNote) {
    return (
      <Screen title="Saved clinical note" eyebrow={patient.name} action={<button className="secondary-button" onClick={() => setSelectedNote(null)}>Back to patient</button>}>
        <ClinicalNoteView savedNote={selectedNote} patientName={patient.name} providerName={providerName} onBack={() => setSelectedNote(null)} />
      </Screen>
    )
  }

  return (
    <Screen
      title={patient.name}
      eyebrow="Patient overview"
      action={<button className="secondary-button" onClick={onBack}>Back to patients</button>}
    >
      {state !== "ready" ? <StatusState type={state} onRetry={() => setRetryKey((key) => key + 1)} /> : summary && <>
        {savedNotice && <div className="success-banner" role="status"><span>✓</span><div><strong>{savedNotice}</strong><span>The note is saved in this patient’s record.</span></div></div>}
        <section className="card patient-today-card">
          <div className="section-heading"><div><span className="section-kicker">TODAY</span><h2>Nutrition totals</h2></div><strong className="patient-calories">{summary.today.calories.toLocaleString()} kcal</strong></div>
          <div className="patient-macros">
            <span>Protein <strong>{summary.today.protein}g</strong></span>
            <span>Carbohydrates <strong>{summary.today.carbs}g</strong></span>
            <span>Fat <strong>{summary.today.fat}g</strong></span>
          </div>
        </section>
        <section className="card patient-week-card">
          <div className="section-heading"><div><span className="section-kicker">LAST 7 DAYS</span><h2>Calories logged</h2></div></div>
          <div className="patient-week-chart">
            {summary.lastSevenDays.map((day) => (
              <div className="patient-week-day" key={day.date}>
                <strong>{day.calories}</strong>
                <div className="patient-week-track"><i style={{ height: `${Math.max(4, Math.min(100, day.calories / 20))}%` }} /></div>
                <small>{new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</small>
              </div>
            ))}
          </div>
        </section>
        <section className="patient-meals-section">
          <div className="section-heading"><div><span className="section-kicker">RECENT ACTIVITY</span><h2>Meal history</h2></div><span className="fresh-pill">{meals.length} meals</span></div>
          {meals.length ? <div className="history-list">
            {meals.map((meal) => (
              <article className="meal-card" key={meal.id}>
                <MealPhoto meal={meal} />
                <div className="meal-copy"><div><span className="meal-type">{meal.mealType}</span><small>{mealDisplayTime(meal)}</small></div><h3>{meal.foodName}</h3><p>{meal.portionSize} · {meal.protein}g P · {meal.carbs}g C · {meal.fat}g F</p>{mealPolicyNutrients(meal) && <p>{mealPolicyNutrients(meal)}</p>}{meal.notes && <p>{meal.notes}</p>}</div>
                <strong className="meal-cal">{meal.calories}<small>kcal</small></strong>
              </article>
            ))}
          </div> : <section className="status-card"><h3>No meals logged yet</h3><p>This patient’s meal history will appear here.</p></section>}
        </section>
        <PolicyCheckPanel patientId={patient.id} />
        <section className="patient-notes-section">
          <div className="section-heading"><div><span className="section-kicker">CLINICAL RECORD</span><h2>Notes</h2></div><span className="fresh-pill">{notes.length} notes</span></div>
          {noteState === "loading" && <div className="charting-context-state"><div className="skeleton wide" /><span>Loading saved note…</span></div>}
          {noteState === "error" && <div className="charting-api-errors" role="alert"><p>{noteError}</p></div>}
          {notes.length ? <div className="saved-note-list">
            {notes.map((savedNote) => (
              <button type="button" className="saved-note-row card" key={savedNote.id} onClick={() => { void openNote(savedNote.id) }} disabled={noteState === "loading"}>
                <span><strong>{savedNote.content.diagnosis.problem.term}</strong><small>{new Date(savedNote.content.date).toLocaleDateString()} · Saved {new Date(savedNote.createdAt).toLocaleDateString()}</small></span>
                <Icon name="arrow" />
              </button>
            ))}
          </div> : <section className="status-card"><h3>No saved notes yet</h3><p>Saved clinical notes for this patient will appear here.</p></section>}
        </section>
        <button className="primary-button patient-start-chart" onClick={onStartChart}>Start chart <Icon name="arrow" /></button>
      </>}
    </Screen>
  )
}

function getLocalDateInputValue() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function formatPolicyValue(value: number | number[]) {
  return Array.isArray(value) ? `${value[0]}–${value[1]}` : String(value)
}

function PolicyCheckPanel({ patientId }: { patientId: string }) {
  const [policies, setPolicies] = useState<DietaryPolicy[]>([])
  const [policiesState, setPoliciesState] = useState<"loading" | "ready" | "error">("loading")
  const [policyRetryKey, setPolicyRetryKey] = useState(0)
  const [policyId, setPolicyId] = useState("national_dietary_guidelines")
  const [date, setDate] = useState(getLocalDateInputValue)
  const [checkState, setCheckState] = useState<"idle" | "loading" | "result" | "empty" | "missing" | "error">("idle")
  const [result, setResult] = useState<PolicyCheckResult | null>(null)
  const [message, setMessage] = useState("")

  useEffect(() => {
    let active = true
    setPoliciesState("loading")
    fetchDietaryPolicies().then((items) => {
      if (!active) return
      setPolicies(items)
      setPoliciesState("ready")
      if (items.length && !items.some((item) => item.id === policyId)) {
        setPolicyId(items[0].id)
      }
    }).catch((error: unknown) => {
      if (!active) return
      setMessage(error instanceof Error ? error.message : "Could not load dietary policies.")
      setPoliciesState("error")
    })
    return () => { active = false }
  }, [policyRetryKey])

  const runCheck = async () => {
    setCheckState("loading")
    setMessage("")
    setResult(null)
    try {
      const response = await runPatientPolicyCheck(patientId, policyId, date)
      if ("noMeals" in response) {
        setMessage(response.message)
        setCheckState("empty")
      } else {
        setResult(response)
        setCheckState("result")
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not run the policy check.")
      setCheckState(error instanceof PolicyMissingDataError ? "missing" : "error")
    }
  }

  return (
    <section className="card policy-check-section">
      <div className="section-heading">
        <div><span className="section-kicker">DIETARY POLICY</span><h2>Policy check</h2></div>
        <span className="fresh-pill">Server-verified meals</span>
      </div>
      {policiesState === "loading" && <div className="policy-message" role="status">Loading available policies…</div>}
      {policiesState === "error" && (
        <div className="policy-message policy-error" role="alert">
          <p>{message}</p>
          <button type="button" className="secondary-button" onClick={() => setPolicyRetryKey((key) => key + 1)}>Try again</button>
        </div>
      )}
      {policiesState === "ready" && !policies.length && (
        <div className="policy-message">No dietary policies are available.</div>
      )}
      {policiesState === "ready" && policies.length > 0 && <>
        <div className="policy-controls">
          <div className="field">
            <label htmlFor="policyId">Dietary policy</label>
            <select id="policyId" value={policyId} onChange={(event) => {
              setPolicyId(event.target.value)
              setCheckState("idle")
              setResult(null)
            }}>
              {policies.map((policy) => <option key={policy.id} value={policy.id}>{policy.name}</option>)}
            </select>
            <small>{policies.find((policy) => policy.id === policyId)?.description}</small>
          </div>
          <div className="field">
            <label htmlFor="policyDate">Meal date</label>
            <input id="policyDate" type="date" value={date} onChange={(event) => {
              setDate(event.target.value)
              setCheckState("idle")
              setResult(null)
            }} />
          </div>
          <button type="button" className="primary-button" disabled={checkState === "loading" || !date} onClick={() => { void runCheck() }}>
            {checkState === "loading" ? "Checking…" : "Run check"}
          </button>
        </div>
        {checkState === "empty" && <div className="policy-message" role="status">{message}</div>}
        {checkState === "missing" && <div className="policy-message policy-missing" role="alert"><strong>More meal data is needed</strong><p>{message}</p></div>}
        {checkState === "error" && <div className="policy-message policy-error" role="alert"><p>{message}</p><button type="button" className="secondary-button" onClick={() => { void runCheck() }}>Try again</button></div>}
        {checkState === "result" && result && (
          <div className="policy-result" role="status">
            <div className="policy-result-heading">
              <span className={`policy-compliance-badge ${result.compliant ? "compliant" : "non-compliant"}`}>
                {result.compliant ? "Compliant" : "Not compliant"}
              </span>
              <strong>Compliance score: {result.compliance_score}%</strong>
            </div>
            {result.violations.length ? (
              <div className="policy-violations">
                <h3>Rule results</h3>
                {result.violations.map((violation, index) => (
                  <article className="policy-violation" key={`${violation.rule_id}-${index}`}>
                    <div className="policy-violation-heading">
                      <strong>{violation.rule_id}</strong>
                      <span className={`policy-severity ${violation.severity}`}>{violation.severity}</span>
                    </div>
                    <p>Actual: <strong>{violation.actual_value}</strong> · Allowed: <strong>{formatPolicyValue(violation.allowed_value)}</strong></p>
                    <p>{violation.message}</p>
                    <small>Source: {violation.source}</small>
                  </article>
                ))}
              </div>
            ) : <p className="policy-message">No policy violations were found for this date.</p>}
          </div>
        )}
      </>}
    </section>
  )
}

function MyCarePlan({ patientName }: { patientName: string }) {
  const [notes, setNotes] = useState<SavedClinicalNote[]>([])
  const [state, setState] = useState<ViewState>("loading")
  const [retryKey, setRetryKey] = useState(0)
  const [selectedNote, setSelectedNote] = useState<SavedClinicalNote | null>(null)

  useEffect(() => {
    let active = true
    setState("loading")
    fetchMyNotes().then((result) => {
      if (!active) return
      setNotes(result)
      setState(result.length ? "ready" : "empty")
    }).catch(() => {
      if (active) setState("error")
    })
    return () => { active = false }
  }, [retryKey])

  if (selectedNote) {
    return (
      <Screen title="My care plan" eyebrow="Read-only clinical note" action={<button className="secondary-button" onClick={() => setSelectedNote(null)}>Back to notes</button>}>
        <ClinicalNoteView savedNote={selectedNote} patientName={patientName} onBack={() => setSelectedNote(null)} />
      </Screen>
    )
  }

  return (
    <Screen title="My care plan" eyebrow="Notes from your dietitian">
      {state === "loading" || state === "error"
        ? <StatusState type={state} onRetry={() => setRetryKey((key) => key + 1)} />
        : state === "empty"
          ? <section className="status-card"><div className="status-icon"><Icon name="heart" size={25} /></div><h3>No care plan notes yet</h3><p>Notes from your dietitian will appear here.</p></section>
          : <div className="saved-note-list">
            {notes.map((savedNote) => (
              <button type="button" className="saved-note-row card" key={savedNote.id} onClick={() => setSelectedNote(savedNote)}>
                <span><strong>{savedNote.content.diagnosis.problem.term}</strong><small>{new Date(savedNote.content.date).toLocaleDateString()} · Saved {new Date(savedNote.createdAt).toLocaleDateString()}</small></span>
                <Icon name="arrow" />
              </button>
            ))}
          </div>}
    </Screen>
  )
}

function Wearable() {
  const [state, setState] = useState<ViewState>("empty")
  const [previewState, setPreviewState] = useState<ViewState>("ready")
  const [source, setSource] = useState<WearableSource>(() => getSelectedWearableSource())
  const [dailyData, setDailyData] = useState<WearableDailyData | null>(null)
  const [weeklyData, setWeeklyData] = useState<WearableDailyData[]>([])
  const displayState = previewState === "ready" ? state : previewState

  const syncActivity = async () => {
    setState("loading")
    try {
      const [today, week] = await Promise.all([
        fetchDailyWearableData(undefined, source),
        fetchWeeklyWearableData(source),
      ])
      setDailyData(today)
      setWeeklyData(week)
      rememberSyncedWearableSource(source)
      setState("ready")
    } catch {
      setState("error")
    }
  }
  const changeSource = (nextSource: WearableSource) => {
    setSource(nextSource)
    rememberSelectedWearableSource(nextSource)
    setDailyData(null)
    setWeeklyData([])
    setState("empty")
    setPreviewState("ready")
  }
  const totalSteps = weeklyData.reduce((total, day) => total + day.steps, 0)
  const averageSteps = weeklyData.length ? Math.round(totalSteps / weeklyData.length) : 0
  const averageEnergy = weeklyData.length
    ? Math.round(weeklyData.reduce((total, day) => total + day.activeEnergyKcal, 0) / weeklyData.length)
    : 0
  return (
    <Screen title="Wearable sync" eyebrow="Activity, all in one place" action={<StatePicker value={previewState} onChange={setPreviewState} />}>
      <div className="wearable-simulation-heading">
        <span className="wearable-simulation-tag">API simulation</span>
        <p>Demo activity from NutriTrack’s local mock API; it does not connect to a real Google or Apple account.</p>
      </div>
      <section className={`device-card ${displayState === "ready" ? "connected" : ""}`}>
        <div className="watch-visual"><Icon name="watch" size={34} /></div>
        <div className="wearable-source-controls">
          <div className="field">
            <label htmlFor="wearableSource">Source</label>
            <select id="wearableSource" value={source} onChange={(event) => changeSource(event.target.value as WearableSource)}>
              <option value="googlefit">Google Fit</option>
              <option value="applehealth">Apple Health</option>
            </select>
          </div>
          <button className="primary-button" onClick={() => { void syncActivity() }} disabled={displayState === "loading"}>
            {displayState === "loading" ? "Syncing…" : "Sync activity"}
          </button>
        </div>
        <div className="wearable-connection-status" aria-live="polite">
          {displayState === "ready" && dailyData
            ? <><span className="section-kicker">CONNECTED · {source === "googlefit" ? "GOOGLE FIT" : "APPLE HEALTH"}</span><p>Last synced {new Date(dailyData.lastSynced).toLocaleString()}</p></>
            : displayState === "loading"
              ? <><span className="section-kicker">SYNCING</span><div className="skeleton wide" /></>
              : displayState === "error"
                ? <StatusState type="error" onRetry={() => { void syncActivity() }} />
                : displayState === "empty"
                  ? <><span className="section-kicker">NOT CONNECTED</span><h2>Not synced yet</h2><p>Choose a source and sync to load simulated activity.</p></>
                  : <div className="skeleton wide" />}
        </div>
      </section>
      {displayState === "ready" && dailyData && <>
        <div className="metric-grid wearable-today-metrics">
          <section className="metric-card"><div className="metric-icon mint"><Icon name="steps" /></div><span>Steps today</span><strong>{dailyData.steps.toLocaleString()}</strong></section>
          <section className="metric-card"><div className="metric-icon peach"><Icon name="flame" /></div><span>Active energy</span><strong>{dailyData.activeEnergyKcal}</strong><small>kcal</small></section>
        </div>
        <section className="card chart-card">
          <div className="section-heading"><div><span className="section-kicker">LAST 7 DAYS</span><h2>Daily movement</h2></div><span className="chart-total">{(totalSteps / 1000).toFixed(1)}k <small>steps</small></span></div>
          <div className="legend"><span><i className="green-dot" /> Steps</span><span><i className="orange-dot" /> Active kcal</span></div>
          <div className="chart">
            {weeklyData.map((day) => {
              const label = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" })
              return <div className="bar-group" key={day.date}><div className="bars"><i className="energy-bar" style={{ height: `${Math.min(100, day.activeEnergyKcal / 9)}%` }} /><i className="steps-bar" style={{ height: `${Math.min(100, day.steps / 140)}%` }} /></div><span>{label}</span></div>
            })}
          </div>
        </section>
        <div className="metric-grid"><section className="metric-card compact"><span>Daily average</span><strong>{averageSteps.toLocaleString()}</strong><small>steps per day</small></section><section className="metric-card compact"><span>Active energy</span><strong>{averageEnergy}</strong><small>avg kcal / day</small></section></div>
      </>}
    </Screen>
  )
}

function Screen({ title, eyebrow, action, children }: { title: string; eyebrow?: string; action?: ReactNode; children: ReactNode }) {
  return <main className="screen"><header className="page-header"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1></div>{action}</header>{children}</main>
}

function Auth({
  onDone,
  onDemo,
  initialMessage,
}: {
  onDone: (user: AuthUser) => void
  onDemo: (role: UserRole) => Promise<AuthUser>
  initialMessage: string
}) {
  const [register, setRegister] = useState(false)
  const [values, setValues] = useState({ name: "", email: "", password: "", role: "consumer" as UserRole })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState(initialMessage)
  const [busy, setBusy] = useState(false)
  useEffect(() => setMessage(initialMessage), [initialMessage])
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (register && values.name.trim().length < 2) next.name = "Please enter your name"
    if (!/^\S+@\S+\.\S+$/.test(values.email)) next.email = "Enter a valid email address"
    if (register && values.password.length < 8) next.password = "Use at least 8 characters"
    if (!register && !values.password) next.password = "Enter your password"
    setErrors(next)
    setMessage("")
    if (Object.keys(next).length) return
    setBusy(true)
    const task = register
      ? registerUser({ name: values.name.trim(), email: values.email.trim(), password: values.password, role: values.role })
      : loginUser(values.email.trim(), values.password)
    void task.then(onDone).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "Could not sign in. Please try again.")
    }).finally(() => setBusy(false))
  }
  const continueDemo = (role: UserRole) => {
    setMessage("")
    setBusy(true)
    void onDemo(role).then(onDone).catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : "Could not sign in to the demo account.")
    }).finally(() => setBusy(false))
  }
  return (
    <div className="auth-shell">
      <section className="auth-brand"><div className="brand-mark"><Icon name="heart" /></div><div className="logo">NutriTrack</div><h1>Healthy habits,<br />made simple.</h1><p>Track meals, understand your energy, and make progress one day at a time.</p><div className="auth-quote">“Small choices add up to lasting change.”</div></section>
      <section className="auth-panel">
        <div className="mobile-logo"><div className="brand-mark"><Icon name="heart" /></div><div className="logo">NutriTrack</div></div>
        <div className="auth-form-wrap">
          <span className="eyebrow">WELCOME TO NUTRITRACK</span><h2>{register ? "Create your account" : "Welcome back"}</h2>
          <p>{register ? "Start building healthier habits today." : "Sign in to continue your journey."}</p>
          {message && <div className="auth-message" role="alert">{message}</div>}
          <form onSubmit={submit} noValidate>
            {register && <>
              <TextAuth label="Full name" name="name" value={values.name} error={errors.name} onChange={(value) => setValues({ ...values, name: value })} />
              <div className="field"><label htmlFor="account-role">Account type</label><select id="account-role" value={values.role} onChange={(event) => setValues({ ...values, role: event.target.value as UserRole })}><option value="consumer">Consumer</option><option value="dietitian">Dietitian</option></select></div>
            </>}
            <TextAuth label="Email address" name="email" value={values.email} error={errors.email} onChange={(value) => setValues({ ...values, email: value })} />
            <TextAuth label="Password" name="password" type="password" value={values.password} error={errors.password} onChange={(value) => setValues({ ...values, password: value })} />
            <button className="primary-button auth-button" disabled={busy}>{busy ? "Please wait…" : register ? "Create account" : "Sign in"} <Icon name="arrow" /></button>
          </form>
          <p className="auth-switch">{register ? "Already have an account?" : "New to NutriTrack?"} <button onClick={() => { setRegister(!register); setErrors({}); setMessage("") }}>{register ? "Sign in" : "Create an account"}</button></p>
          <div className="demo-actions"><span>Or try a seeded demo account</span><button className="demo-link" disabled={busy} onClick={() => continueDemo("consumer")}>Continue as consumer</button><button className="demo-link" disabled={busy} onClick={() => continueDemo("dietitian")}>Continue as dietitian</button></div>
        </div>
      </section>
    </div>
  )
}

function TextAuth({ label, name, value, onChange, error, type = "text" }: { label: string; name: string; value: string; onChange: (v: string) => void; error?: string; type?: string }) {
  return <div className={`field ${error ? "has-error" : ""}`}><label htmlFor={name}>{label}</label><input id={name} type={type} value={value} placeholder={name === "email" ? "you@example.com" : ""} onChange={(e) => onChange(e.target.value)} />{error && <span className="field-error">{error}</span>}</div>
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [restoringSession, setRestoringSession] = useState(() => Boolean(getAuthToken()))
  const [authMessage, setAuthMessage] = useState("")
  const [tab, setTab] = useState<Tab>("home")
  useEffect(() => { window.scrollTo(0, 0) }, [tab])
  useEffect(() => {
    let active = true
    const handleSessionExpired = (event: Event) => {
      const detail = (event as CustomEvent<{ code?: string }>).detail
      setUser(null)
      setTab("home")
      setAuthMessage(detail?.code === "TOKEN_EXPIRED"
        ? "Your session expired. Please log in again."
        : "Your session is no longer valid. Please log in again.")
    }
    window.addEventListener("nutritrack:session-expired", handleSessionExpired)
    if (getAuthToken()) {
      void fetchCurrentUser().then((currentUser) => {
        if (!active) return
        setUser(currentUser)
        setTab(currentUser.role === "dietitian" ? "patients" : "home")
      }).catch((error: unknown) => {
        if (!active) return
        clearAuthToken()
        setAuthMessage(error instanceof AuthApiError && error.code === "TOKEN_EXPIRED"
          ? "Your session expired. Please log in again."
          : "We could not verify your session. Please log in again.")
      }).finally(() => {
        if (active) setRestoringSession(false)
      })
    } else {
      setRestoringSession(false)
    }
    return () => {
      active = false
      window.removeEventListener("nutritrack:session-expired", handleSessionExpired)
    }
  }, [])

  const completeLogin = (authenticatedUser: AuthUser) => {
    setUser(authenticatedUser)
    setAuthMessage("")
    setTab(authenticatedUser.role === "dietitian" ? "patients" : "home")
  }
  const demoLogin = (role: UserRole) => role === "consumer"
    ? loginUser("alex@nutritrack.demo", "ConsumerDemo2026!")
    : loginUser("dietitian@nutritrack.demo", "DietitianDemo2026!")
  const logout = () => {
    clearAuthToken()
    setUser(null)
    setTab("home")
    setAuthMessage("You have been logged out.")
  }

  if (restoringSession) return <div className="auth-shell"><section className="auth-panel"><div className="auth-form-wrap">Checking your NutriTrack session…</div></section></div>
  if (!user) return <Auth onDone={completeLogin} onDemo={demoLogin} initialMessage={authMessage} />
  const isDietitian = user.role === "dietitian"
  const tabs: { id: Tab; label: string; icon: string }[] = isDietitian
    ? [{ id: "patients", label: "Patients", icon: "user" }, { id: "charting", label: "Charting", icon: "chart" }]
    : [{ id: "home", label: "Today", icon: "home" }, { id: "log", label: "Log meal", icon: "plus" }, { id: "history", label: "History", icon: "list" }, { id: "wearable", label: "Wearable", icon: "watch" }, { id: "careplan", label: "My care plan", icon: "heart" }]
  const navigate = (nextTab: Tab) => {
    if (!isDietitian && (nextTab === "charting" || nextTab === "patients")) return
    if (isDietitian && nextTab !== "charting" && nextTab !== "patients") return
    setTab(nextTab)
  }
  const currentTab = !isDietitian && (tab === "charting" || tab === "patients") ? "home" : tab
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-logo"><div className="brand-mark"><Icon name="heart" /></div><span>NutriTrack</span></div>
        <nav>{tabs.map((item) => <button key={item.id} className={currentTab === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>
        <div className="profile"><div className="avatar"><Icon name="user" /></div><div><strong>{user.name}</strong><span>{isDietitian ? "Dietitian" : "Consumer"}</span></div><button className="logout-button" onClick={logout}>Log out</button></div>
      </aside>
      <div className="main-area">
        {currentTab === "home" && <Dashboard goToLog={() => navigate("log")} userName={user.name} />}
        {currentTab === "log" && <MealLog onSave={async (meal) => { await createMeal(meal); navigate("history") }} />}
        {currentTab === "history" && <History />}
        {currentTab === "wearable" && <Wearable />}
        {currentTab === "careplan" && !isDietitian && <MyCarePlan patientName={user.name} />}
        {currentTab === "patients" && isDietitian && <PatientsPage provider={user} />}
        {currentTab === "charting" && isDietitian && <Screen title="Charting" eyebrow="Provider workspace"><section className="card"><h2>Start from a patient record</h2><p>Choose an assigned patient, open their record, and select <strong>Start chart</strong> to create a patient-specific clinical note.</p><button className="primary-button" onClick={() => navigate("patients")}>Go to patients <Icon name="arrow" /></button></section></Screen>}
      </div>
      <nav className="bottom-nav" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>{tabs.map((item) => <button key={item.id} className={currentTab === item.id ? "active" : ""} onClick={() => navigate(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav>
    </div>
  )
}
