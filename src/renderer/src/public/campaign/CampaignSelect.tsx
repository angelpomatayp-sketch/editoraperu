import type { CampaignSummary } from '../../../../shared/campaign'

interface CampaignSelectProps {
  campaigns: CampaignSummary[]
  onSelect: (campaignId: string) => void
}

/**
 * Listado de campañas disponibles (RF-EXP-001, RF-EXP-002): tarjeta con la imagen de la campaña (o la
 * de su primer escenario), franja roja con el nombre y la descripción, y una flecha para entrar.
 */
export function CampaignSelect({ campaigns, onSelect }: CampaignSelectProps): React.JSX.Element {
  return (
    <ul className="campaign-list">
      {campaigns.map((campaign) => (
        <li key={campaign.id}>
          <button type="button" className={`campaign-card${campaign.imageUrl ? '' : ' campaign-card--plain'}`} onClick={() => onSelect(campaign.id)}>
            {campaign.imageUrl && <img src={campaign.imageUrl} alt="" draggable={false} />}
            <span className="campaign-card__text">
              <strong>{campaign.name}</strong>
              {campaign.description && <span>{campaign.description}</span>}
            </span>
            <span className="campaign-card__go" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
