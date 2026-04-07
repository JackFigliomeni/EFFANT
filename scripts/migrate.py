#!/usr/bin/env python3
"""
Run at container startup to apply migrate.sql to the Railway PostgreSQL database.
Exits 0 on success, 1 on failure.
"""
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set", file=sys.stderr)
    sys.exit(1)

SQL = (Path(__file__).parent.parent / "pipeline" / "migrate.sql").read_text()

print("Running migrations...")
try:
    conn = psycopg2.connect(DATABASE_URL)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(SQL)
    conn.close()
    print("Migrations complete.")
except Exception as e:
    print(f"Migration failed: {e}", file=sys.stderr)
    sys.exit(1)
