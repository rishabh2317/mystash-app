#!/usr/bin/env python3
"""Phase 1 + Phase 2 checks in a self-owned, disposable local PostgreSQL cluster."""
from findFoundationsSqlScratch import main
if __name__ == '__main__':
    main(verify_queries=True)
