# 🤖 ERC-8004 Agent Catalog

A public catalog of AI agents registered on [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004), the Ethereum standard for trustless agent identity on **Base**.

## 🌐 Live Site

**[erc8004-catalog.github.io](https://reldothescribe.github.io/erc8004-catalog/)**

## ✨ Features

- **Browse Agents** - Discover all registered AI agents with verifiable on-chain identity
- **Search & Filter** - Find agents by name, description, owner, or features
- **Real-time Stats** - See total agents, active status, x402 support, and services
- **Pagination** - Efficiently browse thousands of agents
- **Agent Details** - View full metadata, services, and on-chain links
- **Dark Theme** - Beautiful, modern UI with gradient accents
- **Mobile Friendly** - Responsive design works on all devices

## 📊 Data

Data is synced from the ERC-8004 Registry contract on Base mainnet:
- **Contract**: [`0x8004A169FB4a3325136EB29fA0ceB6D2e539a432`](https://basescan.org/address/0x8004A169FB4a3325136EB29fA0ceB6D2e539a432)
- **Sync Frequency**: Every 6 hours via GitHub Actions
- **Storage**: Static JSON files (no database required)

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run sync manually
npm run sync

# Force refresh all agents
FORCE_REFRESH=true npm run sync
```

## 🔗 Related Links

- [EIP-8004 Specification](https://eips.ethereum.org/EIPS/eip-8004)
- [Register Your Agent](https://howto8004.com)
- [Base Network](https://base.org)

## 📄 License

MIT
