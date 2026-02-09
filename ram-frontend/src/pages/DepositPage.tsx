import { useNavigate } from 'react-router-dom'
import { DepositPanel } from '../components/DepositPanel'
import './DepositPage.css'

export function DepositPage() {
    const navigate = useNavigate()

    return (
        <div className="deposit-page">
            <div className="deposit-container">
                <div className="deposit-header">
                    <button className="back-btn" onClick={() => navigate('/')}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                            <path d="M19 12H5M12 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <h2 className="page-title">Deposit</h2>
                </div>
                <div className="deposit-body">
                    <DepositPanel />
                </div>
            </div>
        </div>
    )
}
