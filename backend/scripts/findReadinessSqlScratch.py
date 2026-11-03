#!/usr/bin/env python3
"""Integrated Find contract checks in disposable PostgreSQL; no live credentials/providers."""
from findFoundationsSqlScratch import main

if __name__ == '__main__':
    main(verify_queries=True, verify_images=True, verify_delivery=True, verify_readiness=True)
