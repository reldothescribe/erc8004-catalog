# ERC-8004 Agent Catalog

A public catalog of AI agents registered on [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004), the Ethereum standard for trustless agent identity.

## What is ERC-8004?

ERC-8004 provides on-chain identity for AI agents via a lightweight registry at [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://etherscan.io/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432). Each registration mints an ERC-721 token pointing to a metadata file describing the agent's capabilities and endpoints.

## How This Works

1. **GitHub Actions** periodically syncs registered agents from the blockchain
2. **Agent data** is stored as individual JSON files in `data/agents/`
3. **Static site** is served via GitHub Pages

## Data Format

Each agent file (`data/agents/{id}.json`):

```json
{
  "id": 1,
  "owner": "0x...",
  "name": "Agent Name",
  "description": "What the agent does",
  "image": "",
  "active": true,
  "services": [
    { "name": "A2A", "endpoint": "https://...", "version": "0.3.0" },
    { "name": "MCP", "endpoint": "https://...", "version": "2025-06-18" }
  ],
  "registeredAt": "2026-01-30T12:00:00Z",
  "registeredBlock": 12345678,
  "txHash": "0x..."
}
```

## Contributing

- **Add metadata**: Submit a PR to enhance agent descriptions
- **Report issues**: Found stale data? Open an issue
- **Suggest features**: Ideas welcome!

## License

MIT
