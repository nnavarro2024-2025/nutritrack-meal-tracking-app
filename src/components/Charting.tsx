import { FormEvent, useEffect, useMemo, useRef, useState } from "react"
import {
  AssessmentDomain,
  ClinicalNote,
  NoteValidationFailure,
  NotesTerminology,
  fetchNotesTerminology,
  validateClinicalNote,
} from "../services/notesService"

type PreviewState = "ready" | "loading" | "empty" | "error"
type StepIndex = 0 | 1 | 2 | 3 | 4
type AssessmentRow = {
  id: number
  domain: AssessmentDomain | ""
  term: string
  value: string
  unit: string
}
type ChartingForm = {
  patientId: string
  providerId: string
  date: string
  assessmentRows: AssessmentRow[]
  problem: string
  problemCode: string
  etiology: string
  signsSymptomsText: string
  interventionCategory: string
  interventionTerm: string
  goal: string
  frequency: string
  startDate: string
  indicator: string
  target: string
  measuredResult: string
  status: string
}
type FieldErrors = Record<string, string[]>

const steps = ["Assessment", "Diagnosis", "Intervention", "Monitoring & Evaluation"]
const today = () => {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function createInitialForm(): ChartingForm {
  return {
    patientId: "patient-demo-001",
    providerId: "provider-demo-001",
    date: today(),
    assessmentRows: [],
    problem: "",
    problemCode: "",
    etiology: "",
    signsSymptomsText: "",
    interventionCategory: "",
    interventionTerm: "",
    goal: "",
    frequency: "",
    startDate: today(),
    indicator: "",
    target: "",
    measuredResult: "",
    status: "",
  }
}

function SearchableSelect({
  id,
  label,
  value,
  options,
  onChange,
  error,
  required = true,
}: {
  id: string
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  error?: string
  required?: boolean
}) {
  const listId = `${id}-options`
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>{label}{required && <span className="required-marker" aria-label="required"> *</span>}</label>
      <input
        id={id}
        list={listId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={`Search ${label.toLowerCase()}...`}
        autoComplete="off"
        required={required}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        data-validation-error={error ? "true" : undefined}
      />
      <datalist id={listId}>
        {options.map((option) => <option key={option} value={option} />)}
      </datalist>
      {error && <span id={`${id}-error`} className="field-error">{error}</span>}
    </div>
  )
}

function FormField({
  id,
  label,
  value,
  onChange,
  error,
  type = "text",
  placeholder,
  multiline = false,
  required = true,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  type?: string
  placeholder?: string
  multiline?: boolean
  required?: boolean
}) {
  return (
    <div className={`field ${error ? "has-error" : ""}`}>
      <label htmlFor={id}>{label}{required && <span className="required-marker" aria-label="required"> *</span>}</label>
      {multiline ? (
        <textarea id={id} rows={3} required={required} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} data-validation-error={error ? "true" : undefined} />
      ) : (
        <input id={id} type={type} required={required} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} data-validation-error={error ? "true" : undefined} />
      )}
      {error && <span id={`${id}-error`} className="field-error">{error}</span>}
    </div>
  )
}

function PreviewPicker({ value, onChange }: { value: PreviewState; onChange: (value: PreviewState) => void }) {
  return (
    <select className="state-picker" value={value} onChange={(event) => onChange(event.target.value as PreviewState)} aria-label="Preview screen state">
      <option value="ready">Ready state</option>
      <option value="loading">Loading state</option>
      <option value="empty">Empty state</option>
      <option value="error">Error state</option>
    </select>
  )
}

function makeErrorMap(errors: Array<{ path: string; message: string }>): FieldErrors {
  return errors.reduce<FieldErrors>((result, error) => {
    const assessmentDomainMatch = error.path.match(/^\/assessment\/domains\/\d+\/domain$/)
    const assessmentItemMatch = error.path.match(/^\/assessment\/domains\/\d+\/items\/\d+\/(.+)$/)
    let key = error.path.replace(/^\//, "").replace(/\//g, ".")
    if (assessmentDomainMatch) key = "assessment.domain"
    if (assessmentItemMatch) key = `assessment.${assessmentItemMatch[1]}`
    if (key === "diagnosis.problem.term") key = "problem"
    if (key === "diagnosis.problem.code") key = "problemCode"
    if (key.startsWith("diagnosis.")) key = key.replace("diagnosis.", "")
    if (key.startsWith("intervention.schedule.")) key = key.replace("intervention.schedule.", "")
    if (key.startsWith("intervention.")) key = key.replace("intervention.", "")
    if (key.startsWith("monitoringEvaluation.")) key = key.replace("monitoringEvaluation.", "")
    result[key] = [...(result[key] || []), error.message]
    return result
  }, {})
}

export default function Charting() {
  const [terms, setTerms] = useState<NotesTerminology | null>(null)
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading")
  const [previewState, setPreviewState] = useState<PreviewState>("ready")
  const [step, setStep] = useState<StepIndex>(0)
  const [form, setForm] = useState(createInitialForm)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [serverMessages, setServerMessages] = useState<string[]>([])
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle")
  const [nextRowId, setNextRowId] = useState(1)
  const [stepErrorMessage, setStepErrorMessage] = useState("")
  const [validationAttempted, setValidationAttempted] = useState(false)
  const chartingContainer = useRef<HTMLElement>(null)

  const loadTerms = async () => {
    setLoadState("loading")
    try {
      const data = await fetchNotesTerminology()
      setTerms(data)
      setLoadState("ready")
    } catch {
      setLoadState("error")
    }
  }

  useEffect(() => { void loadTerms() }, [])
  useEffect(() => {
    if (!validationAttempted) return
    const firstInvalid = chartingContainer.current?.querySelector<HTMLElement>('[data-validation-error="true"]')
    if (firstInvalid) {
      firstInvalid.focus()
      firstInvalid.scrollIntoView({ behavior: "smooth", block: "center" })
    }
  }, [errors, step, validationAttempted])

  const signsSymptoms = useMemo(
    () => form.signsSymptomsText.split("\n").map((item) => item.trim()).filter(Boolean),
    [form.signsSymptomsText],
  )
  const problem = form.problem.trim()
  const pesSentence = problem && form.etiology.trim() && signsSymptoms.length
    ? `${problem} related to ${form.etiology.trim()} as evidenced by ${signsSymptoms.join("; ")}`
    : "Complete problem, etiology, and signs/symptoms to build the PES statement."

  const updateForm = <K extends keyof ChartingForm>(key: K, value: ChartingForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: [] }))
    setServerMessages([])
    setSaveState("idle")
    setStepErrorMessage("")
  }
  const messages = (key: string) => errors[key]?.join(" ") || ""

  const addAssessmentRow = () => {
    const row: AssessmentRow = {
      id: nextRowId,
      domain: "",
      term: "",
      value: "",
      unit: "",
    }
    setNextRowId((id) => id + 1)
    updateForm("assessmentRows", [...form.assessmentRows, row])
    setErrors((current) => ({ ...current, "assessment.rows": [] }))
  }
  const updateAssessmentRow = (id: number, changes: Partial<AssessmentRow>) => {
    updateForm("assessmentRows", form.assessmentRows.map((row) => row.id === id ? { ...row, ...changes } : row))
    setErrors((current) => ({
      ...current,
      "assessment.domain": [],
      "assessment.term": [],
      "assessment.value": [],
      "assessment.unit": [],
    }))
  }
  const removeAssessmentRow = (id: number) => {
    updateForm("assessmentRows", form.assessmentRows.filter((row) => row.id !== id))
  }

  const isValidDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
  }

  const validateStep = (stepIndex: number) => {
    const next: FieldErrors = {}
    const requireValue = (key: string, value: string, label: string) => {
      if (!value.trim()) next[key] = [`${label} is required.`]
    }
    const requireOption = (key: string, value: string, options: string[], label: string) => {
      if (!value.trim()) {
        next[key] = [`${label} is required.`]
      } else if (!options.includes(value)) {
        next[key] = [`Choose a ${label.toLowerCase()} from the available terms.`]
      }
    }
    if (stepIndex === 0) {
      requireValue("patientId", form.patientId, "Patient ID")
      requireValue("providerId", form.providerId, "Provider ID")
      requireValue("date", form.date, "Note date")
      if (form.date && !isValidDate(form.date)) next.date = ["Enter a valid note date."]
      if (!form.assessmentRows.length) next["assessment.rows"] = ["Add at least one assessment finding."]
      form.assessmentRows.forEach((row) => {
        requireOption("assessment.domain", row.domain, terms?.assessmentDomain || [], "Assessment domain")
        requireOption("assessment.term", row.term, terms?.assessmentMonitoringTerm || [], "Standardized term")
        requireValue("assessment.value", row.value, "Value")
        requireValue("assessment.unit", row.unit, "Unit")
      })
    }
    if (stepIndex === 1) {
      requireOption("problem", form.problem, terms?.diagnosisTerm || [], "Problem")
      if (form.problem && terms?.diagnosisCodeByTerm[form.problem] && form.problemCode !== terms.diagnosisCodeByTerm[form.problem]) {
        next.problemCode = ["Use the provided diagnosis code for this term."]
      }
      requireValue("etiology", form.etiology, "Etiology")
      if (!signsSymptoms.length) next.signsSymptoms = ["Add at least one sign or symptom."]
    }
    if (stepIndex === 2) {
      requireOption("interventionCategory", form.interventionCategory, terms?.interventionCategory || [], "Category")
      requireOption("interventionTerm", form.interventionTerm, terms?.interventionTerm || [], "Intervention term")
      requireValue("goal", form.goal, "Goal")
      requireValue("frequency", form.frequency, "Schedule frequency")
      requireValue("startDate", form.startDate, "Start date")
      if (form.startDate && !isValidDate(form.startDate)) next.startDate = ["Enter a valid start date."]
    }
    if (stepIndex === 3) {
      requireOption("indicator", form.indicator, terms?.assessmentMonitoringTerm || [], "Indicator")
      requireValue("target", form.target, "Target")
      requireValue("measuredResult", form.measuredResult, "Measured result")
      requireOption("status", form.status, terms?.monitoringStatus || [], "Status")
    }
    setErrors(next)
    setValidationAttempted(true)
    setStepErrorMessage(Object.keys(next).length ? "Please complete the required fields." : "")
    return Object.keys(next).length === 0
  }

  const buildNote = (): ClinicalNote => ({
    patientId: form.patientId.trim(),
    providerId: form.providerId.trim(),
    date: form.date,
    assessment: {
      domains: form.assessmentRows.reduce<ClinicalNote["assessment"]["domains"]>((groups, row) => {
        const domain = row.domain as AssessmentDomain
        let group = groups.find((item) => item.domain === domain)
        if (!group) {
          group = { domain, items: [] }
          groups.push(group)
        }
        group.items.push({ term: row.term, value: row.value, unit: row.unit })
        return groups
      }, []),
    },
    diagnosis: {
      problem: {
        term: form.problem,
        ...(form.problemCode ? { code: form.problemCode } : {}),
      },
      etiology: form.etiology.trim(),
      signsSymptoms,
      generatedSentence: pesSentence,
    },
    intervention: {
      category: form.interventionCategory,
      term: form.interventionTerm,
      goal: form.goal.trim(),
      schedule: { frequency: form.frequency.trim(), startDate: form.startDate },
    },
    monitoringEvaluation: {
      indicator: form.indicator,
      target: form.target.trim(),
      measuredResult: form.measuredResult.trim(),
      status: form.status,
    },
  })

  const goNext = () => {
    if (validateStep(step)) {
      setStep((current) => Math.min(current + 1, 4) as StepIndex)
      setServerMessages([])
    }
  }
  const saveNote = async (event: FormEvent) => {
    event.preventDefault()
    for (let index = 0; index < 4; index += 1) {
      if (!validateStep(index)) {
        setStep(index as StepIndex)
        return
      }
    }
    setErrors({})
    setServerMessages([])
    setSaveState("saving")
    try {
      await validateClinicalNote(buildNote())
      setSaveState("saved")
    } catch (error) {
      setSaveState("idle")
      if (error instanceof NoteValidationFailure) {
        setErrors(makeErrorMap(error.errors))
        setServerMessages(error.errors.map((item) => `${item.path}: ${item.message}`))
        setValidationAttempted(true)
        const firstPath = error.errors[0]?.path || ""
        const invalidStep = firstPath.startsWith("/assessment") ? 0
          : firstPath.startsWith("/diagnosis") ? 1
          : firstPath.startsWith("/intervention") ? 2
          : firstPath.startsWith("/monitoringEvaluation") ? 3
          : 4
        setStep(invalidStep as StepIndex)
        setStepErrorMessage(invalidStep < 4 ? "Please correct the highlighted fields." : "")
      } else {
        setServerMessages([error instanceof Error ? error.message : "Could not validate the note."])
      }
    }
  }

  const changePreviewState = (value: PreviewState) => {
    setPreviewState(value)
    if (value === "ready" && loadState === "error") void loadTerms()
  }

  const selectedProblemCode = (term: string) => terms?.diagnosisCodeByTerm[term] || ""
  const note = step === 4 ? buildNote() : null

  return (
    <main className="screen charting-screen" ref={chartingContainer}>
      <header className="page-header">
        <div><span className="eyebrow">PROVIDER WORKSPACE</span><h1>Clinical charting</h1></div>
        <PreviewPicker value={previewState} onChange={changePreviewState} />
      </header>

      {previewState === "loading" || loadState === "loading" ? (
        <div className="charting-state"><div className="skeleton wide" /><p>Loading clinical terminology…</p></div>
      ) : previewState === "error" || loadState === "error" ? (
        <div className="charting-state charting-state-error"><h2>Couldn’t load terminology</h2><p>Check that the backend is running, then try again.</p><button className="secondary-button" onClick={() => { setPreviewState("ready"); void loadTerms() }}>Try again</button></div>
      ) : previewState === "empty" ? (
        <div className="charting-state"><div className="status-icon">＋</div><h2>No note started</h2><p>Begin a new patient note to document the Nutrition Care Process.</p><button className="primary-button" onClick={() => setPreviewState("ready")}>Start a note</button></div>
      ) : !terms || !terms.assessmentDomain.length ? (
        <div className="charting-state charting-state-error"><h2>No terminology available</h2><p>The terminology service returned no charting terms.</p><button className="secondary-button" onClick={() => void loadTerms()}>Reload terms</button></div>
      ) : (
        <>
          <div className="charting-progress" aria-label="Charting progress">
            {steps.map((label, index) => (
              <button
                type="button"
                key={label}
                className={`charting-progress-step ${step === index ? "current" : ""} ${step > index ? "complete" : ""}`}
                onClick={() => { if (index <= step) setStep(index as StepIndex) }}
                aria-current={step === index ? "step" : undefined}
              >
                <span>{step > index ? "✓" : index + 1}</span><small>{label}</small>
              </button>
            ))}
          </div>

          <form onSubmit={saveNote} noValidate>
            {step === 0 && (
              <section className="card charting-card">
                <div className="section-heading"><div><span className="section-kicker">STEP 1 OF 4</span><h2>Assessment</h2></div><span className="fresh-pill">Patient record</span></div>
                <div className="charting-patient-grid">
                  <FormField id="patientId" label="Patient ID" value={form.patientId} onChange={(value) => updateForm("patientId", value)} error={messages("patientId")} />
                  <FormField id="providerId" label="Provider ID" value={form.providerId} onChange={(value) => updateForm("providerId", value)} error={messages("providerId")} />
                  <FormField id="noteDate" label="Note date" type="date" value={form.date} onChange={(value) => updateForm("date", value)} error={messages("date")} />
                </div>
                <div className="charting-section-title"><div><h3>Assessment findings</h3><p>Choose a domain and a standardized term for each finding.</p></div><button type="button" className="secondary-button charting-add" onClick={addAssessmentRow}>＋ Add finding</button></div>
                {!form.assessmentRows.length && (
                  <div className={`charting-empty ${messages("assessment.rows") ? "has-error" : ""}`}>
                    <p>No findings added yet.</p>
                    <button type="button" className="secondary-button" onClick={addAssessmentRow} data-validation-error={messages("assessment.rows") ? "true" : undefined}>Add first finding</button>
                    {messages("assessment.rows") && <span className="field-error">{messages("assessment.rows")}</span>}
                  </div>
                )}
                <div className="charting-finding-list">
                  {form.assessmentRows.map((row, index) => (
                    <article className="charting-finding" key={row.id}>
                      <div className="charting-finding-heading"><strong>Finding {index + 1}</strong><button type="button" className="charting-remove" onClick={() => removeAssessmentRow(row.id)} aria-label={`Remove finding ${index + 1}`}>Remove</button></div>
                      <SearchableSelect id={`domain-${row.id}`} label="Assessment domain" value={row.domain} options={terms.assessmentDomain} onChange={(value) => updateAssessmentRow(row.id, { domain: terms.assessmentDomain.includes(value as AssessmentDomain) ? value as AssessmentDomain : "" })} error={messages("assessment.domain")} />
                      <div className="charting-two-column">
                          <SearchableSelect
                            id={`assessment-term-${row.id}`}
                            label="Standardized term"
                            value={row.term}
                            options={terms.assessmentMonitoringTerm}
                            onChange={(value) => updateAssessmentRow(row.id, {
                              term: value,
                              domain: terms.assessmentDomainByTerm[value] || row.domain,
                            })}
                            error={messages("assessment.term")}
                          />
                        </div>
                      <div className="charting-two-column">
                        <FormField id={`assessment-value-${row.id}`} label="Value" value={row.value} onChange={(value) => updateAssessmentRow(row.id, { value })} error={messages("assessment.value")} placeholder="Enter finding" />
                        <FormField id={`assessment-unit-${row.id}`} label="Unit" value={row.unit} onChange={(value) => updateAssessmentRow(row.id, { unit: value })} error={messages("assessment.unit")} placeholder="e.g. kg, mg/dL, description" />
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {step === 1 && (
              <section className="card charting-card">
                <div className="section-heading"><div><span className="section-kicker">STEP 2 OF 4</span><h2>Nutrition diagnosis</h2></div><span className="fresh-pill">PES statement</span></div>
                <div className="charting-form-stack">
                  <SearchableSelect id="diagnosisProblem" label="Problem (standardized term)" value={form.problem} options={terms.diagnosisTerm} onChange={(value) => { updateForm("problem", value); updateForm("problemCode", selectedProblemCode(value)) }} error={messages("problem")} />
                  {form.problemCode && <p className="charting-code-note">Standardized code: {form.problemCode}</p>}
                  {messages("problemCode") && <span className="field-error" data-validation-error="true" tabIndex={-1}>{messages("problemCode")}</span>}
                  <FormField id="etiology" label="Etiology (related to)" value={form.etiology} onChange={(value) => updateForm("etiology", value)} error={messages("etiology")} placeholder="What is contributing to the problem?" />
                  <FormField id="signsSymptoms" label="Signs and symptoms (one per line)" value={form.signsSymptomsText} onChange={(value) => updateForm("signsSymptomsText", value)} error={messages("signsSymptoms")} placeholder={"Reported intake below estimated needs\nFrequently skips lunch"} multiline />
                  <div className="pes-preview"><span className="section-kicker">LIVE PES STATEMENT</span><p>{pesSentence}</p></div>
                </div>
              </section>
            )}

            {step === 2 && (
              <section className="card charting-card">
                <div className="section-heading"><div><span className="section-kicker">STEP 3 OF 4</span><h2>Nutrition intervention</h2></div><span className="fresh-pill">Plan of care</span></div>
                <div className="charting-form-stack">
                  <SearchableSelect id="interventionCategory" label="Category" value={form.interventionCategory} options={terms.interventionCategory} onChange={(value) => updateForm("interventionCategory", value)} error={messages("interventionCategory")} />
                  <SearchableSelect
                    id="interventionTerm"
                    label="Intervention term"
                    value={form.interventionTerm}
                    options={terms.interventionTerm}
                    onChange={(value) => {
                      updateForm("interventionTerm", value)
                      const category = terms.interventionCategoryByTerm[value]
                      if (category) updateForm("interventionCategory", category)
                    }}
                    error={messages("interventionTerm")}
                  />
                  <FormField id="interventionGoal" label="Goal" value={form.goal} onChange={(value) => updateForm("goal", value)} error={messages("goal")} placeholder="Describe the measurable nutrition goal" multiline />
                  <div className="charting-two-column">
                    <FormField id="scheduleFrequency" label="Schedule / frequency" value={form.frequency} onChange={(value) => updateForm("frequency", value)} error={messages("frequency")} placeholder="e.g. Review weekly" />
                    <FormField id="startDate" label="Start date" type="date" value={form.startDate} onChange={(value) => updateForm("startDate", value)} error={messages("startDate")} />
                  </div>
                </div>
              </section>
            )}

            {step === 3 && (
              <section className="card charting-card">
                <div className="section-heading"><div><span className="section-kicker">STEP 4 OF 4</span><h2>Monitoring &amp; Evaluation</h2></div><span className="fresh-pill">Track outcomes</span></div>
                <div className="charting-form-stack">
                  <SearchableSelect id="monitoringIndicator" label="Indicator" value={form.indicator} options={terms.assessmentMonitoringTerm} onChange={(value) => updateForm("indicator", value)} error={messages("indicator")} />
                  <FormField id="monitoringTarget" label="Target" value={form.target} onChange={(value) => updateForm("target", value)} error={messages("target")} placeholder="Define the intended outcome" />
                  <FormField id="measuredResult" label="Measured result" value={form.measuredResult} onChange={(value) => updateForm("measuredResult", value)} error={messages("measuredResult")} placeholder="Record baseline or current result" />
                  <SearchableSelect id="monitoringStatus" label="Status" value={form.status} options={terms.monitoringStatus} onChange={(value) => updateForm("status", value)} error={messages("status")} />
                </div>
              </section>
            )}

            {step === 4 && note && (
              <section className="card charting-card clinical-note-review">
                <div className="section-heading review-heading"><div><span className="section-kicker">FINAL REVIEW</span><h2>Review &amp; Save Note</h2></div><button type="button" className="secondary-button print-button" onClick={() => window.print()}>Print / Export</button></div>
                <header className="clinical-note-header">
                  <div className="brand-mark">N</div>
                  <div><span className="section-kicker">NUTRITION CARE NOTE</span><h3>Patient {note.patientId}</h3><p>Provider {note.providerId} · {note.date}</p></div>
                </header>
                <div className="clinical-note-section">
                  <span className="section-kicker">01 · ASSESSMENT</span>
                  {note.assessment.domains.map((group) => (
                    <div className="clinical-note-domain" key={group.domain}><h3>{group.domain}</h3>
                      {group.items.map((item, index) => <p key={`${item.code}-${index}`}><strong>{item.term}</strong> <span>({item.code})</span>: {item.value} {item.unit}</p>)}
                    </div>
                  ))}
                  {errors["assessment.rows"]?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                </div>
                <div className="clinical-note-section">
                  <span className="section-kicker">02 · DIAGNOSIS</span>
                  <p className="clinical-pes">{note.diagnosis.generatedSentence}</p>
                  {errors.problem?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                  {errors.etiology?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                  {errors.signsSymptoms?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                  {errors.generatedSentence?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                </div>
                <div className="clinical-note-section">
                  <span className="section-kicker">03 · INTERVENTION</span>
                  <p><strong>{note.intervention.category}</strong> · {note.intervention.term}</p>
                  <p>{note.intervention.goal}</p>
                  <p className="clinical-note-muted">{note.intervention.schedule.frequency} · Starts {note.intervention.schedule.startDate}</p>
                  {errors.interventionCategory?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                  {errors.interventionTerm?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                  {errors.goal?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                </div>
                <div className="clinical-note-section">
                  <span className="section-kicker">04 · MONITORING &amp; EVALUATION</span>
                  <p><strong>{note.monitoringEvaluation.indicator}</strong></p>
                  <p>Target: {note.monitoringEvaluation.target}</p>
                  <p>Measured result: {note.monitoringEvaluation.measuredResult}</p>
                  <span className="fresh-pill">{note.monitoringEvaluation.status}</span>
                  {errors.indicator?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                  {errors.target?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                  {errors.measuredResult?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                  {errors.status?.map((message) => <span className="field-error" key={message}>{message}</span>)}
                </div>
                {Object.entries(errors).filter(([key]) => key.startsWith("assessment.")).map(([key, messagesForKey]) => <p className="field-error review-error" key={key}>{messagesForKey.join(" ")}</p>)}
                {serverMessages.length > 0 && (
                  <div className="charting-api-errors" role="alert">
                    <strong>Note needs attention</strong>
                    {serverMessages.map((message) => <p key={message}>{message}</p>)}
                  </div>
                )}
                {saveState === "saved" && <div className="success-banner" role="status"><span>✓</span><div><strong>Note validated</strong><span>It’s ready to save. Notes are not stored in a database yet.</span></div></div>}
              </section>
            )}

            <div className="charting-actions">
              {step > 0 && <button type="button" className="secondary-button" onClick={() => setStep((current) => (current - 1) as StepIndex)}>Back</button>}
              {stepErrorMessage && <p className="charting-step-error" role="alert">{stepErrorMessage}</p>}
              {step < 4 ? (
                <button type="button" className="primary-button charting-next" onClick={goNext}>{step === 3 ? "Review note" : "Next"} <span aria-hidden="true">→</span></button>
              ) : (
                <button type="submit" className="primary-button charting-next" disabled={saveState === "saving"}>{saveState === "saving" ? "Validating…" : saveState === "saved" ? "Validated" : "Validate & Save Note"}</button>
              )}
            </div>
          </form>
        </>
      )}
    </main>
  )
}
