import { useEffect, useMemo, useState } from 'react'
import {
  autoFrameId,
  maxCharacters,
  charactersForScenario,
  needsCharacterStep,
  needsFrameStep,
  type CampaignDetail,
  type CampaignList
} from '../../../shared/campaign'
import type { PublicSettings, SessionEndReason } from '../../../shared/ipc'
import {
  validateParticipant,
  type ParticipantField,
  type ParticipantFieldErrors,
  type ParticipantInput
} from '../../../shared/participant'
import type { ConsentText } from '../../../shared/registration'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { StepLayout } from '../ui/StepLayout'
import { CaptureFlow } from './capture/CaptureFlow'
import { DownloadScreen } from './download/DownloadScreen'
import { CampaignSelect } from './campaign/CampaignSelect'
import { OptionGrid } from './campaign/OptionGrid'
import { SelectionSummary, type SummaryTarget } from './campaign/SelectionSummary'
import { ConsentScreen } from './consent/ConsentScreen'
import { RegisterForm } from './register/RegisterForm'

type Step = 'campaign' | 'scenario' | 'character' | 'frame' | 'summary' | 'register' | 'consent'
type Status = 'loading' | 'ready' | 'empty' | 'error' | 'capture' | 'delivered'

interface DraftSelections {
  scenarioId: string | null
  characterIds: string[]
  frameId: string | null
}

const EMPTY_PARTICIPANT: ParticipantInput = { firstNames: '', lastNames: '', dni: '' }
const GENERIC_ERROR = 'No fue posible completar el registro. Por favor, intente nuevamente.'

interface ExperienceFlowProps {
  sessionId: string
  settings: PublicSettings
  onEnd: (reason: SessionEndReason) => void
  /** Pausa la inactividad mientras se muestra el QR, que tiene su propio cierre automático. */
  onPauseInactivity: (paused: boolean) => void
}

/**
 * Recorrido desde la selección de campaña hasta los consentimientos (sección 7, pasos 4 a 7).
 * Todo el estado vive en este componente: al terminar la sesión se descarta (RF-SES-004).
 */
export function ExperienceFlow({ sessionId, settings, onEnd, onPauseInactivity }: ExperienceFlowProps): React.JSX.Element {
  const [status, setStatus] = useState<Status>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [list, setList] = useState<CampaignList | null>(null)
  const [campaignSkipped, setCampaignSkipped] = useState(false)
  const [detail, setDetail] = useState<CampaignDetail | null>(null)
  const [step, setStep] = useState<Step>('campaign')
  const [selections, setSelections] = useState<DraftSelections>({ scenarioId: null, characterIds: [], frameId: null })
  const [participant, setParticipant] = useState<ParticipantInput>(EMPTY_PARTICIPANT)
  const [fieldErrors, setFieldErrors] = useState<ParticipantFieldErrors>({})
  const [registerAttempt, setRegisterAttempt] = useState(0)
  const [consents, setConsents] = useState<ConsentText[]>([])
  const [accepted, setAccepted] = useState<Record<string, boolean>>({})
  const [rejecting, setRejecting] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const sequence = useMemo<Step[]>(() => {
    const steps: Step[] = campaignSkipped ? [] : ['campaign']
    if (!detail) return steps
    steps.push('scenario')
    if (needsCharacterStep(detail, selections.scenarioId)) steps.push('character')
    if (needsFrameStep(detail)) steps.push('frame')
    steps.push('summary', 'register', 'consent')
    return steps
  }, [campaignSkipped, detail, selections.scenarioId])

  const index = sequence.indexOf(step)
  const goNext = () => setStep(sequence[index + 1] ?? step)
  const goBack = index > 0 ? () => setStep(sequence[index - 1]!) : undefined
  const registerIndex = sequence.indexOf('register')
  const hasUnsavedData =
    Object.values(participant).some((v) => v.length > 0) || (registerIndex >= 0 && index >= registerIndex)
  const cancel = () => onEnd('cancelled')

  const loadConsents = async () => {
    setConsents(await window.totem.listConsents())
    setAccepted({})
  }

  const chooseCampaign = async (campaignId: string, skipped: boolean) => {
    const result = await window.totem.selectCampaign(sessionId, campaignId)
    if (!result) {
      setMessage('Esta experiencia ya no está disponible. Por favor, elija otra.')
      const refreshed = await window.totem.listCampaigns(sessionId)
      setList(refreshed)
      setCampaignSkipped(false)
      setDetail(null)
      setStep('campaign')
      setStatus(refreshed.campaigns.length > 0 ? 'ready' : 'empty')
      return
    }
    setMessage(null)
    setCampaignSkipped(skipped)
    setDetail(result)
    setSelections({ scenarioId: null, characterIds: [], frameId: autoFrameId(result) })
    setStep('scenario')
    setStatus('ready')
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [campaigns] = await Promise.all([window.totem.listCampaigns(sessionId), loadConsents()])
        if (cancelled) return
        setList(campaigns)
        if (campaigns.campaigns.length === 0) setStatus('empty')
        else if (campaigns.campaigns.length === 1 && campaigns.skipSingleCampaign) {
          await chooseCampaign(campaigns.campaigns[0]!.id, true)
        } else setStatus('ready')
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId]) // Solo al iniciar la sesión.

  const updateParticipant = (field: ParticipantField, value: string) => {
    setParticipant((p) => ({ ...p, [field]: value }))
    setFieldErrors((e) => ({ ...e, [field]: undefined }))
  }

  const completeSelections = () => ({
    scenarioId: selections.scenarioId ?? '',
    characterIds: selections.characterIds,
    frameId: selections.frameId
  })

  /** Agrega o quita un personaje; el orden de elección define su posición en la foto. */
  const toggleCharacter = (id: string | null) => {
    if (!detail) return
    setSelections((s) => {
      if (id === null) return { ...s, characterIds: [] }
      if (s.characterIds.includes(id)) return { ...s, characterIds: s.characterIds.filter((c) => c !== id) }
      const max = maxCharacters(detail, s.scenarioId)
      // Con un solo personaje permitido, tocar otro lo reemplaza.
      if (max === 1) return { ...s, characterIds: [id] }
      return s.characterIds.length < max ? { ...s, characterIds: [...s.characterIds, id] } : s
    })
  }

  /** Un toque en el escenario lo elige y pasa al paso siguiente, sin botón «Continuar». */
  const chooseScenario = (id: string | null) => {
    if (!detail || !id) return
    // Al cambiar de escenario se conservan solo los personajes que también le corresponden.
    const available = charactersForScenario(detail, id).map((c) => c.id)
    setSelections((s) => ({ ...s, scenarioId: id, characterIds: s.characterIds.filter((c) => available.includes(c)) }))
    // El paso siguiente depende del escenario elegido (si ofrece personajes).
    setStep(needsCharacterStep(detail, id) ? 'character' : needsFrameStep(detail) ? 'frame' : 'summary')
  }

  const submitRegister = () => {
    const result = validateParticipant(participant)
    if (!result.ok) {
      setFieldErrors(result.errors)
      setRegisterAttempt((n) => n + 1)
      return
    }
    setFieldErrors({})
    goNext()
  }

  const submitConsents = async () => {
    if (!detail || submitting) return
    setSubmitting(true)
    try {
      const result = await window.totem.register({
        sessionId,
        campaignId: detail.id,
        selections: completeSelections(),
        participant,
        consents: consents.map((c) => ({ versionId: c.id, accepted: accepted[c.id] === true }))
      })
      if (result.ok) {
        setStatus('capture')
        return
      }
      if (result.error === 'invalid_data' && result.fields) {
        setFieldErrors(result.fields)
        setRegisterAttempt((n) => n + 1)
        setStep('register')
      } else if (result.error === 'consent_outdated') {
        await loadConsents()
        setMessage('Los términos se actualizaron. Por favor, léalos y acéptelos nuevamente.')
      } else {
        setMessage(GENERIC_ERROR)
        setStatus('error')
      }
    } catch {
      setMessage(GENERIC_ERROR)
      setStatus('error')
    } finally {
      setSubmitting(false)
    }
  }

  if (status === 'loading') return <main className="screen" aria-busy="true" />

  if (status === 'capture' && detail) {
    return (
      <CaptureFlow
        sessionId={sessionId}
        detail={detail}
        selections={completeSelections()}
        settings={settings.capture}
        chroma={settings.chroma}
        background={settings.background}
        onContinue={() => {
          onPauseInactivity(true)
          setStatus('delivered')
        }}
        onEnd={onEnd}
      />
    )
  }

  if (status === 'delivered') {
    return <DownloadScreen sessionId={sessionId} settings={settings} onFinish={() => onEnd('completed')} />
  }

  if (status === 'empty' || status === 'error') {
    return (
      <main className="screen screen--message">
        <h1>{status === 'empty' ? 'Aún no hay escenarios disponibles' : 'Ocurrió un problema'}</h1>
        <p>
          {status === 'empty'
            ? 'Todavía no se ha creado ninguna experiencia con escenarios. El personal debe crearla y activarla desde el panel de administración.'
            : (message ?? GENERIC_ERROR)}
        </p>
        <button type="button" className="touch-button" onClick={cancel}>
          Volver al inicio
        </button>
      </main>
    )
  }

  const layout = { onBack: goBack, onCancel: cancel, hasUnsavedData }
  const next = (label: string, enabled: boolean, onClick: () => void = goNext) => (
    <button type="button" className="touch-button" disabled={!enabled} onClick={onClick}>
      {label}
    </button>
  )
  const notice = message && <p className="inline-notice" role="status">{message}</p>

  switch (step) {
    case 'campaign':
      return (
        <StepLayout {...layout} title="Elija una experiencia" subtitle="Seleccione cómo desea participar">
          {notice}
          <CampaignSelect campaigns={list?.campaigns ?? []} onSelect={(id) => void chooseCampaign(id, false)} />
        </StepLayout>
      )
    case 'scenario':
      return (
        <StepLayout {...layout} title="Elija un escenario" subtitle={detail?.name}>
          <OptionGrid
            variant="scene"
            options={detail!.scenarios}
            selectedIds={selections.scenarioId ? [selections.scenarioId] : []}
            onSelect={chooseScenario}
          />
        </StepLayout>
      )
    case 'character': {
      const max = maxCharacters(detail!, selections.scenarioId)
      const count = selections.characterIds.length
      return (
        <StepLayout
          {...layout}
          title={max > 1 ? 'Elija sus personajes' : 'Elija un personaje'}
          subtitle={max > 1 ? `Puede elegir hasta ${max}. Elegidos: ${count} de ${max}.` : undefined}
          footer={next('Continuar', detail!.characterMode === 'optional' || count > 0)}
        >
          <OptionGrid
            variant="character"
            options={charactersForScenario(detail!, selections.scenarioId)}
            selectedIds={selections.characterIds}
            multiple={max > 1}
            noneLabel={detail!.characterMode === 'optional' ? 'Sin personaje' : undefined}
            onSelect={toggleCharacter}
          />
        </StepLayout>
      )
    }
    case 'frame':
      return (
        <StepLayout
          {...layout}
          title="Elija un marco"
          footer={next('Continuar', detail!.frameMode === 'optional' || selections.frameId !== null)}
        >
          <OptionGrid
            variant="scene"
            options={detail!.frames}
            selectedIds={selections.frameId ? [selections.frameId] : []}
            noneLabel={detail!.frameMode === 'optional' ? 'Sin marco' : undefined}
            onSelect={(id) => setSelections((s) => ({ ...s, frameId: id }))}
          />
        </StepLayout>
      )
    case 'summary':
      return (
        <StepLayout {...layout} title="Su selección" subtitle="Revise su elección antes de continuar." footer={next('Continuar', true)}>
          <SelectionSummary
            detail={detail!}
            selections={completeSelections()}
            editable={sequence.filter((s): s is SummaryTarget => s === 'scenario' || s === 'character' || s === 'frame')}
            onEdit={setStep}
          />
        </StepLayout>
      )
    case 'register':
      return (
        <StepLayout {...layout} title="Sus datos" footer={next('Continuar', true, submitRegister)}>
          <RegisterForm value={participant} errors={fieldErrors} attempt={registerAttempt} onChange={updateParticipant} />
        </StepLayout>
      )
    case 'consent': {
      const allRequired = consents.length > 0 && consents.every((c) => !c.isRequired || accepted[c.id] === true)
      return (
        <StepLayout
          {...layout}
          title="Términos y condiciones"
          subtitle="Marque cada casilla para continuar. Toque «Ver detalle» para leer el texto completo."
          footer={
            <div className="footer-actions">
              <button type="button" className="touch-button touch-button--secondary" onClick={() => setRejecting(true)}>
                No acepto
              </button>
              {next(submitting ? 'Registrando…' : 'Continuar', allRequired && !submitting, () => void submitConsents())}
            </div>
          }
        >
          {notice}
          <ConsentScreen
            consents={consents}
            accepted={accepted}
            onToggle={(id) => setAccepted((a) => ({ ...a, [id]: !a[id] }))}
          />
          {rejecting && (
            <ConfirmDialog
              title="No es posible continuar"
              message="Para tomarse la fotografía es necesario aceptar los términos y autorizaciones obligatorios."
              cancelLabel="Volver a leer"
              confirmLabel="Cancelar participación"
              onCancel={() => setRejecting(false)}
              onConfirm={cancel}
            />
          )}
        </StepLayout>
      )
    }
  }
}
