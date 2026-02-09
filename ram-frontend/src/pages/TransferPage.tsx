import { useNavigate } from 'react-router-dom'
import { TransferPanel } from '../components/TransferPanel'
import './TransferPage.css'

export function TransferPage() {
    const navigate = useNavigate()

    return (
        <div className="transfer-page">
            <div className="transfer-container">
                <div className="transfer-header">
                    <button className="back-btn" onClick={() => navigate('/')}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h2 className="page-title">Transfer</h2>
                </div>
                <div className="transfer-body">
                    <TransferPanel />
                </div>
            </div>
        </div>
    )
}
