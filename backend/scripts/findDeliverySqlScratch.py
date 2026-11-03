#!/usr/bin/env python3
"""Full local Find/notification/measurement fixtures; no dotenv, live services or push sends."""
from findFoundationsSqlScratch import main
if __name__ == '__main__':
    main(verify_queries=True, verify_images=True, verify_delivery=True)
