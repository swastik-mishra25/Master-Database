"""
Unified Integrated System Runner.
Coordinates Dakini AI ICP Scraper and Master Spreadsheet Management System together.
Starting this script starts both systems and the dynamic lead sync daemon.
Stopping this script (Ctrl+C) gracefully terminates BOTH systems together.
"""
import atexit
import os
import signal
import subprocess
import sys
if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
import time

from core.scraper_manager import scraper_manager
from core.sync_engine import DakiniSyncEngine


def main():
    print("=" * 68)
    print("🚀 UNIFIED MASTER DATABASE & DAKINI AI INTEGRATED SYSTEM")
    print("=" * 68)

    # 1. Start Dakini Scraper
    print("\n[1/3] 🤖 Starting Dakini AI ICP Scraper on port 3000...")
    live_mode = "--live" in sys.argv
    started, msg = scraper_manager.start(live_mode=live_mode)
    print(f"      {msg}")

    # 2. Start Dynamic Sync Engine
    print("\n[2/3] 🔄 Starting Dynamic Excel Synchronizer...")
    sync_engine = DakiniSyncEngine()
    # Run initial sync
    init_res = sync_engine.sync_once()
    if init_res.get("changed"):
        print(f"      Initial sync: +{init_res['new_leads']} new leads added to Master.xlsx (Total: {init_res['total_master_rows']})")
    else:
        print(f"      Initial check: Master.xlsx is up to date ({init_res['total_master_rows']} rows).")

    # Start sync daemon in background
    sync_engine.start_watcher(interval_seconds=15)
    print("      Dynamic sync watcher active (monitoring lead updates every 15s).")

    # 3. Start Streamlit Master Database
    print("\n[3/3] 📊 Launching Master Database Presentation Layer (Streamlit)...")
    print("=" * 68)
    print("👉 Dakini Scraper:    http://localhost:3000")
    print("👉 Master Database:   http://localhost:8501")
    print("⚠️ Press Ctrl+C in this terminal to STOP BOTH systems together.")
    print("=" * 68 + "\n")

    def cleanup(*args):
        print("\n\n🛑 Initiating coordinated shutdown of all systems...")
        sync_engine.stop_watcher()
        scraper_manager.stop()
        print("✅ Scraper and synchronizer stopped.")
        sys.exit(0)

    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)
    atexit.register(cleanup)

    # Run Streamlit in the foreground
    try:
        subprocess.run(["streamlit", "run", "app.py"], check=True)
    except KeyboardInterrupt:
        pass
    finally:
        cleanup()


if __name__ == "__main__":
    main()
