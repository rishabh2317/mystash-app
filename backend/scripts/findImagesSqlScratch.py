#!/usr/bin/env python3
"""All Find phases in a self-owned temporary PostgreSQL; no dotenv or production access."""
from findFoundationsSqlScratch import main
if __name__ == '__main__':
    main(verify_queries=True, verify_images=True)
