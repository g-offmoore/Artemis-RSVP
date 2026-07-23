-- EventMessageType: add PREFLIGHT for the T-24h readiness/warning pass (rules.md §11.1).
ALTER TYPE "EventMessageType" ADD VALUE IF NOT EXISTS 'PREFLIGHT';
