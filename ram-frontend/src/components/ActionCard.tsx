import './ActionCard.css'

interface ActionCardProps {
    title: string
    icon: 'transfer' | 'deposit'
    onClick?: () => void
}

export function ActionCard({ title, icon, onClick }: ActionCardProps) {
    return (
        <div className="action-card" onClick={onClick}>
            <div className="action-card-overlay">
                <h3 className="action-card-title">{title}</h3>
                <div className="action-card-icon">
                    {icon === 'transfer' ? (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M7 17L17 7M17 7H7M17 7V17" />
                        </svg>
                    ) : (
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 7L7 17M7 17H17M7 17V7" />
                        </svg>
                    )}
                </div>
            </div>
        </div>
    )
}
