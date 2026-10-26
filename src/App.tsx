import { FormEvent, ReactNode, useEffect, useState } from "react"
import {
  initialMeals,
  Meal,
  todaySummary,
} from "./data/mockData"
import Charting from "./components/Charting"
import { fetchDailyWearableData, fetchWeeklyWearableData, WearableDailyData } from "./services/wearableService"

type Tab = "home" | "log" | "history" | "wearable" | "charting"
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

function Dashboard({ goToLog }: { goToLog: () => void }) {
  const [state, setState] = useState<ViewState>("loading")
  const [wearableData, setWearableData] = useState<WearableDailyData | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  useEffect(() => {
    let active = true
    setState("loading")
    fetchDailyWearableData()
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
  }, [refreshKey])
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
  const calPct = Math.round((todaySummary.calories.current / todaySummary.calories.goal) * 100)
  return (
    <Screen title="Good morning, Alex" eyebrow="Sunday, May 18" action={<StatePicker value={state} onChange={setState} />}>
      <section className="calorie-card">
        <div><span className="section-kicker">TODAY’S ENERGY</span><div className="calorie-number">{todaySummary.calories.current.toLocaleString()}</div><p>of {todaySummary.calories.goal.toLocaleString()} kcal</p></div>
        <div className="calorie-gauge" style={{ "--pct": `${calPct * 3.6}deg` } as React.CSSProperties}><div><strong>{todaySummary.calories.goal - todaySummary.calories.current}</strong><small>left</small></div></div>
      </section>
      <section className="card">
        <div className="section-heading"><div><span className="section-kicker">DAILY BALANCE</span><h2>Macronutrients</h2></div><span className="fresh-pill">On track</span></div>
        <div className="rings">{todaySummary.macros.map((m) => <ProgressRing key={m.label} {...m} />)}</div>
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
type MealForm = Record<(typeof fields)[number], string> & { type: string; notes: string }

function MealLog({ onSave }: { onSave: (meal: Meal) => void }) {
  const blank: MealForm = { type: "Breakfast", food: "", portion: "", calories: "", protein: "", carbs: "", fat: "", notes: "" }
  const [form, setForm] = useState(blank)
  const [errors, setErrors] = useState<Partial<Record<keyof MealForm, string>>>({})
  const [preview, setPreview] = useState("")
  const [success, setSuccess] = useState(false)
  const update = (key: keyof MealForm, value: string) => setForm((old) => ({ ...old, [key]: value }))
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: typeof errors = {}
    fields.forEach((key) => { if (!form[key].trim()) next[key] = "This field is required" })
    if (Number(form.calories) < 0) next.calories = "Enter a valid amount"
    setErrors(next)
    if (Object.keys(next).length) return
    onSave({ id: Date.now(), type: form.type, name: form.food, portion: form.portion, calories: Number(form.calories), protein: Number(form.protein), carbs: Number(form.carbs), fat: Number(form.fat), time: "Just now", image: preview })
    setForm(blank); setPreview(""); setSuccess(true)
    setTimeout(() => setSuccess(false), 3500)
  }
  return (
    <Screen title="Log a meal" eyebrow="Add what you ate">
      {success && <div className="success-banner"><Icon name="check" /><div><strong>Meal saved</strong><span>Your daily totals are updated.</span></div></div>}
      <form className="meal-form" onSubmit={submit} noValidate>
        <section className="card form-card">
          <div className="field"><label htmlFor="mealType">Meal type</label><select id="mealType" value={form.type} onChange={(e) => update("type", e.target.value)}><option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snack</option></select></div>
          <TextField label="Food name" name="food" placeholder="e.g. Grilled chicken salad" form={form} update={update} error={errors.food} />
          <div className="form-row"><TextField label="Portion size" name="portion" placeholder="e.g. 1 bowl" form={form} update={update} error={errors.portion} /><TextField label="Calories" name="calories" placeholder="0" type="number" form={form} update={update} error={errors.calories} /></div>
          <div className="form-row three"><TextField label="Protein (g)" name="protein" placeholder="0" type="number" form={form} update={update} error={errors.protein} /><TextField label="Carbs (g)" name="carbs" placeholder="0" type="number" form={form} update={update} error={errors.carbs} /><TextField label="Fat (g)" name="fat" placeholder="0" type="number" form={form} update={update} error={errors.fat} /></div>
          <div className="field"><label htmlFor="notes">Notes <span>Optional</span></label><textarea id="notes" rows={3} placeholder="How did it make you feel?" value={form.notes} onChange={(e) => update("notes", e.target.value)} /></div>
          <label className="photo-upload">
            {preview ? <img src={preview} alt="Meal preview" /> : <><div className="upload-icon"><Icon name="camera" /></div><strong>Add a meal photo</strong><span>PNG or JPG, up to 5MB</span></>}
            <input type="file" accept="image/*" onChange={(e) => { const file = e.target.files?.[0]; if (file) setPreview(URL.createObjectURL(file)) }} />
          </label>
        </section>
        <button className="primary-button" type="submit">Save meal <Icon name="arrow" /></button>
      </form>
    </Screen>
  )
}

function TextField({ label, name, placeholder, type = "text", form, update, error }: { label: string; name: keyof MealForm; placeholder: string; type?: string; form: MealForm; update: (k: keyof MealForm, v: string) => void; error?: string }) {
  return <div className={`field ${error ? "has-error" : ""}`}><label htmlFor={name}>{label}</label><input id={name} type={type} min="0" placeholder={placeholder} value={form[name]} onChange={(e) => update(name, e.target.value)} />{error && <span className="field-error">{error}</span>}</div>
}

function History({ meals }: { meals: Meal[] }) {
  const [state, setState] = useState<ViewState>("ready")
  return (
    <Screen title="Meal history" eyebrow="Your recent meals" action={<StatePicker value={state} onChange={setState} />}>
      {state !== "ready" ? <StatusState type={state} onRetry={() => setState("ready")} /> : <div className="history-list">
        <div className="history-date"><span>Today</span><small>{meals.filter((m) => m.time !== "Yesterday").length} meals</small></div>
        {meals.map((meal) => <article className="meal-card" key={meal.id}>{meal.image ? <img src={meal.image} alt="" /> : <div className="meal-placeholder"><Icon name="camera" /></div>}<div className="meal-copy"><div><span className="meal-type">{meal.type}</span><small>{meal.time}</small></div><h3>{meal.name}</h3><p>{meal.portion} · {meal.protein}g P · {meal.carbs}g C · {meal.fat}g F</p></div><strong className="meal-cal">{meal.calories}<small>kcal</small></strong></article>)}
      </div>}
    </Screen>
  )
}

function Wearable() {
  const [state, setState] = useState<ViewState>("loading")
  const [connected, setConnected] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [lastSynced, setLastSynced] = useState<string | null>(null)
  const [weeklyData, setWeeklyData] = useState<WearableDailyData[]>([])
  const loadWeek = async () => {
    setState("loading")
    try {
      setWeeklyData(await fetchWeeklyWearableData())
      setState("ready")
    } catch {
      setState("error")
    }
  }
  useEffect(() => { void loadWeek() }, [])
  const connect = async () => {
    setSyncing(true)
    try {
      const [today, week] = await Promise.all([
        fetchDailyWearableData(),
        fetchWeeklyWearableData(),
      ])
      setWeeklyData(week)
      setLastSynced(today.lastSynced)
      setConnected(true)
      setState("ready")
    } catch {
      setState("error")
    } finally {
      setSyncing(false)
    }
  }
  const totalSteps = weeklyData.reduce((total, day) => total + day.steps, 0)
  const averageSteps = weeklyData.length ? Math.round(totalSteps / weeklyData.length) : 0
  const averageEnergy = weeklyData.length
    ? Math.round(weeklyData.reduce((total, day) => total + day.activeEnergyKcal, 0) / weeklyData.length)
    : 0
  return (
    <Screen title="Wearable sync" eyebrow="Activity, all in one place" action={<StatePicker value={state} onChange={setState} />}>
      {state !== "ready" ? <StatusState type={state} onRetry={() => { void loadWeek() }} /> : <>
        <section className={`device-card ${connected ? "connected" : ""}`}>
          <div className="watch-visual"><Icon name="watch" size={34} /></div>
          <div><span className="section-kicker">{connected ? "CONNECTED" : "NO DEVICE CONNECTED"}</span><h2>{connected ? "Apple Watch" : "Connect your wearable"}</h2><p>{connected && lastSynced ? `Last synced ${new Date(lastSynced).toLocaleString()}` : "Bring your steps and workouts into NutriTrack."}</p></div>
          <button className={connected ? "secondary-button" : "primary-button"} onClick={() => { void connect() }} disabled={syncing}>{syncing ? "Connecting…" : connected ? "Sync now" : "Connect device"}</button>
        </section>
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

function Auth({ onDone }: { onDone: () => void }) {
  const [register, setRegister] = useState(false)
  const [values, setValues] = useState({ name: "", email: "", password: "" })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const next: Record<string, string> = {}
    if (register && values.name.trim().length < 2) next.name = "Please enter your name"
    if (!/^\S+@\S+\.\S+$/.test(values.email)) next.email = "Enter a valid email address"
    if (values.password.length < 6) next.password = "Use at least 6 characters"
    setErrors(next)
    if (!Object.keys(next).length) onDone()
  }
  return <div className="auth-shell"><section className="auth-brand"><div className="brand-mark"><Icon name="heart" /></div><div className="logo">NutriTrack</div><h1>Healthy habits,<br />made simple.</h1><p>Track meals, understand your energy, and make progress one day at a time.</p><div className="auth-quote">“Small choices add up to lasting change.”</div></section><section className="auth-panel"><div className="mobile-logo"><div className="brand-mark"><Icon name="heart" /></div><div className="logo">NutriTrack</div></div><div className="auth-form-wrap"><span className="eyebrow">WELCOME TO NUTRITRACK</span><h2>{register ? "Create your account" : "Welcome back"}</h2><p>{register ? "Start building healthier habits today." : "Sign in to continue your journey."}</p><form onSubmit={submit} noValidate>{register && <TextAuth label="Full name" name="name" value={values.name} error={errors.name} onChange={(v) => setValues({ ...values, name: v })} />}<TextAuth label="Email address" name="email" value={values.email} error={errors.email} onChange={(v) => setValues({ ...values, email: v })} /><TextAuth label="Password" name="password" type="password" value={values.password} error={errors.password} onChange={(v) => setValues({ ...values, password: v })} /><button className="primary-button auth-button">{register ? "Create account" : "Sign in"} <Icon name="arrow" /></button></form><p className="auth-switch">{register ? "Already have an account?" : "New to NutriTrack?"} <button onClick={() => { setRegister(!register); setErrors({}) }}>{register ? "Sign in" : "Create an account"}</button></p><button className="demo-link" onClick={onDone}>Continue with demo data</button></div></section></div>
}

function TextAuth({ label, name, value, onChange, error, type = "text" }: { label: string; name: string; value: string; onChange: (v: string) => void; error?: string; type?: string }) {
  return <div className={`field ${error ? "has-error" : ""}`}><label htmlFor={name}>{label}</label><input id={name} type={type} value={value} placeholder={name === "email" ? "you@example.com" : ""} onChange={(e) => onChange(e.target.value)} />{error && <span className="field-error">{error}</span>}</div>
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false)
  const [tab, setTab] = useState<Tab>("home")
  const [meals, setMeals] = useState(initialMeals)
  useEffect(() => { window.scrollTo(0, 0) }, [tab])
  if (!authenticated) return <Auth onDone={() => setAuthenticated(true)} />
  const tabs: { id: Tab; label: string; icon: string }[] = [{ id: "home", label: "Today", icon: "home" }, { id: "log", label: "Log meal", icon: "plus" }, { id: "history", label: "History", icon: "list" }, { id: "wearable", label: "Wearable", icon: "watch" }, { id: "charting", label: "Charting", icon: "chart" }]
  return <div className="app-shell"><aside className="sidebar"><div className="sidebar-logo"><div className="brand-mark"><Icon name="heart" /></div><span>NutriTrack</span></div><nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav><div className="profile"><div className="avatar"><Icon name="user" /></div><div><strong>Alex Morgan</strong><span>Free plan</span></div></div></aside><div className="main-area">{tab === "home" && <Dashboard goToLog={() => setTab("log")} />}{tab === "log" && <MealLog onSave={(meal) => { setMeals([meal, ...meals]); setTab("history") }} />}{tab === "history" && <History meals={meals} />}{tab === "wearable" && <Wearable />}{tab === "charting" && <Charting />}</div><nav className="bottom-nav">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)}><Icon name={item.icon} /><span>{item.label}</span></button>)}</nav></div>
}
