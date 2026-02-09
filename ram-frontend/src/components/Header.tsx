import { ConnectButton } from '@mysten/dapp-kit'
import './Header.css'

export function Header() {


    return (
        <header className="header">
            <div className="header-logo">
                <span className="logo-icon">🐏</span>
                <span className="logo-text">ram</span>
            </div>
            <div className="header-wallet">
                <ConnectButton
                    connectText="login with wallet"
                />
            </div>
        </header>
    )
}
