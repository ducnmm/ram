# RAM — What & Why

## Problem

Crypto wallets today rely on passwords and seed phrases. If someone forces you to transfer funds at gunpoint or under coercion, there's **nothing stopping it**.

## Solution

**RAM** is a wallet that requires you to **speak** to confirm high-value transactions. Your voice is analyzed in real-time for signs of **stress or duress** — all inside a secure enclave that no one (not even us) can tamper with.

- **Normal voice** → Transaction goes through
- **Stress detected** → Wallet auto-locks for 24 hours, funds are safe

## Why It Matters

- **Anti-coercion by design** — The attacker can't bypass voice analysis
- **Blind response** — The app never reveals whether duress was detected; only the blockchain knows
- **Zero trust** — Voice analysis + signing happens inside AWS Nitro Enclave (TEE), tamper-proof even from the server operator

## Why It Matters for AI Agents

AI agents can now execute commands and sign transactions. RAM ensures **no agent can bypass voice verification** — they can propose, but only a calm human voice can authorize.

## Built On

**Sui blockchain** + **Nautilus TEE framework** + **Hume AI** (emotion analysis) + **OpenClaw** (AI agent gateway)
